"""Iteration 10 regression tests for /api/analyze + prompt adaptation."""
import base64
import io
import os
import sys
from pathlib import Path

import pytest
import requests
from PIL import Image

# Ensure /app/backend on import path
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from server import _build_analysis_prompt, AnalyzeIn, ClinicalHistoryIn  # noqa: E402

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or \
    "https://github-file-copier.preview.emergentagent.com"

TEST_EMAIL = "test1@example.com"
TEST_PASSWORD = "secret123"


# ---------- helpers ----------
def _jpeg_base64(size=(600, 600), color=(180, 100, 90)) -> str:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Prompt-adaptation unit tests ----------
class TestPromptAdaptation:
    def test_single_photo_wording(self):
        data = AnalyzeIn(images=[_jpeg_base64()])
        p = _build_analysis_prompt(data)
        assert "single clinical photograph" in p
        assert "SAME lesion" not in p
        assert "No clinical history was provided." in p

    def test_multi_photo_wording(self):
        data = AnalyzeIn(images=[_jpeg_base64(), _jpeg_base64()],
                         viewLabels=["Main / front view", "Left-angle view"])
        p = _build_analysis_prompt(data)
        assert "SAME lesion" in p
        assert "Integrate information across all images" in p
        assert "Main / front view" in p
        assert "Left-angle view" in p

    def test_history_wording_present(self):
        data = AnalyzeIn(
            images=[_jpeg_base64()],
            history=ClinicalHistoryIn(location="left forearm", duration="2 weeks"),
        )
        p = _build_analysis_prompt(data)
        assert "Integrate the supplied clinical history" in p
        assert "Anatomical location: left forearm" in p
        assert "Duration: 2 weeks" in p
        assert "No clinical history was provided." not in p

    def test_empty_history_falls_back(self):
        data = AnalyzeIn(
            images=[_jpeg_base64()],
            history=ClinicalHistoryIn(location="   ", duration=""),
        )
        p = _build_analysis_prompt(data)
        assert "No clinical history was provided." in p
        assert "Integrate the supplied clinical history" not in p


# ---------- /api/analyze validation ----------
class TestAnalyzeValidation:
    def test_no_auth_returns_401(self):
        r = requests.post(f"{BASE_URL}/api/analyze",
                          json={"images": [_jpeg_base64()]}, timeout=30)
        assert r.status_code == 401

    def test_zero_images_rejected(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/analyze",
                          headers=auth_headers, json={"images": []}, timeout=30)
        assert r.status_code == 422

    def test_seven_images_rejected(self, auth_headers):
        payload = {"images": [_jpeg_base64() for _ in range(7)]}
        r = requests.post(f"{BASE_URL}/api/analyze",
                          headers=auth_headers, json=payload, timeout=30)
        assert r.status_code == 422


# ---------- /api/analyze real AI calls ----------
def _assert_analysis_shape(body: dict):
    assert isinstance(body, dict), body
    for k in ("assessmentPossible", "moreInfoNeeded", "redFlags",
              "mostLikelyDiagnosis", "imageQuality", "disclaimer"):
        assert k in body, f"missing key {k}: {body}"
    assert isinstance(body["moreInfoNeeded"], list)
    assert isinstance(body["redFlags"], list)
    assert isinstance(body["assessmentPossible"], bool)


class TestAnalyzeCombinations:
    """Four combinations required by iteration 10.

    NOTE: real Gemini call — a flat synthetic JPEG will often come back with
    assessmentPossible:false. That is documented as expected behaviour, so we
    only assert response *shape* + status.
    """

    def test_one_image_only(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/analyze", headers=auth_headers,
                          json={"images": [_jpeg_base64()]}, timeout=120)
        assert r.status_code == 200, r.text
        _assert_analysis_shape(r.json())

    def test_one_image_with_history(self, auth_headers):
        payload = {
            "images": [_jpeg_base64()],
            "history": {"location": "left forearm", "duration": "2 weeks",
                        "symptoms": "mild itch"},
        }
        r = requests.post(f"{BASE_URL}/api/analyze", headers=auth_headers,
                          json=payload, timeout=120)
        assert r.status_code == 200, r.text
        _assert_analysis_shape(r.json())

    def test_multi_image_with_view_labels(self, auth_headers):
        payload = {
            "images": [_jpeg_base64(color=(200, 120, 100)),
                       _jpeg_base64(color=(180, 100, 90))],
            "viewLabels": ["Main / front view", "Left-angle view"],
        }
        r = requests.post(f"{BASE_URL}/api/analyze", headers=auth_headers,
                          json=payload, timeout=120)
        assert r.status_code == 200, r.text
        _assert_analysis_shape(r.json())

    def test_multi_image_with_history_and_view_labels(self, auth_headers):
        payload = {
            "images": [_jpeg_base64(color=(200, 120, 100)),
                       _jpeg_base64(color=(180, 100, 90))],
            "viewLabels": ["Main / front view", "Close-up"],
            "history": {"location": "left forearm", "duration": "2 weeks"},
        }
        r = requests.post(f"{BASE_URL}/api/analyze", headers=auth_headers,
                          json=payload, timeout=120)
        assert r.status_code == 200, r.text
        _assert_analysis_shape(r.json())


# ---------- Regression: other endpoints still 200 ----------
class TestRegression:
    def test_login_ok(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_me_ok(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == TEST_EMAIL

    def test_device_status_ok(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/device/status",
                         headers=auth_headers, params={"device_id": "TEST-ITER10-XX"},
                         timeout=30)
        assert r.status_code == 200
        assert "activated" in r.json()

    def test_activation_tool_ok(self):
        r = requests.get(f"{BASE_URL}/api/activation-tool", timeout=30)
        assert r.status_code == 200
        assert "Offline Activation Generator" in r.text

    def test_report_pdf_ok(self, auth_headers):
        html = "<html><body><h1>Report</h1><p>Information Used</p></body></html>"
        r = requests.post(f"{BASE_URL}/api/report/pdf", headers=auth_headers,
                          json={"html": html, "filename": "TEST_iter10.pdf"}, timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
