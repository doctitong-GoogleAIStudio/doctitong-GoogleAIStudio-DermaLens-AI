"""Backend tests for iteration 7 — PDF report endpoint + auth regression.

Covers:
- POST /api/report/pdf: success, unauth, base64 image, unsafe filename
- Regression: /api/auth/login, /api/auth/me, /api/activation-tool
"""
import base64
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "http://localhost:8000"
BASE_URL = BASE_URL.rstrip("/")

TEST_EMAIL = "test1@example.com"
TEST_PASSWORD = "secret123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    return data["access_token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# --------- /api/report/pdf ---------
class TestReportPdf:
    def test_pdf_success_basic(self, auth_headers):
        body = {"html": "<h1>AI Dermatologist</h1><p>x</p>", "filename": "test.pdf"}
        r = requests.post(f"{BASE_URL}/api/report/pdf", json=body, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower()
        assert ".pdf" in cd.lower()
        assert r.content.startswith(b"%PDF-")
        assert len(r.content) > 500

    def test_pdf_unauthorized(self):
        r = requests.post(f"{BASE_URL}/api/report/pdf",
                          json={"html": "<p>x</p>", "filename": "x.pdf"},
                          headers={"Content-Type": "application/json"}, timeout=30)
        assert r.status_code == 401

    def test_pdf_with_base64_image(self, auth_headers):
        # Tiny valid JPEG (1x1) base64
        jpeg_b64 = (
            "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwc"
            "KDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
            "MjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEA"
            "AAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhED"
            "EQA/AJVAAf/Z"
        )
        html = (f'<h1>Scan</h1><p>Report body</p>'
                f'<img src="data:image/jpeg;base64,{jpeg_b64}" style="width:100px;height:100px"/>')
        body = {"html": html, "filename": "AiDerma-Scan-2026-01-01.pdf"}
        r = requests.post(f"{BASE_URL}/api/report/pdf", json=body, headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        assert r.content.startswith(b"%PDF-")
        assert len(r.content) > 2048, f"PDF too small: {len(r.content)} bytes"

    def test_pdf_unsafe_filename_sanitised(self, auth_headers):
        body = {"html": "<p>x</p>", "filename": "../../etc/pass wd/<bad>.pdf"}
        r = requests.post(f"{BASE_URL}/api/report/pdf", json=body, headers=auth_headers, timeout=30)
        assert r.status_code == 200
        cd = r.headers.get("content-disposition", "")
        assert cd.lower().endswith('.pdf"') or ".pdf" in cd.lower()
        # Should not contain path separators or angle brackets
        assert "/" not in cd
        assert "<" not in cd and ">" not in cd

    def test_pdf_filename_without_ext_gets_pdf(self, auth_headers):
        body = {"html": "<p>x</p>", "filename": "AiDerma-Report"}
        r = requests.post(f"{BASE_URL}/api/report/pdf", json=body, headers=auth_headers, timeout=30)
        assert r.status_code == 200
        cd = r.headers.get("content-disposition", "").lower()
        assert ".pdf" in cd


# --------- Regression ---------
class TestRegression:
    def test_login_200(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["email"] == TEST_EMAIL
        assert d["token_type"] == "bearer"

    def test_me_200(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == TEST_EMAIL

    def test_activation_tool_200(self):
        r = requests.get(f"{BASE_URL}/api/activation-tool", timeout=30)
        assert r.status_code == 200
        assert "Offline Activation Generator" in r.text
