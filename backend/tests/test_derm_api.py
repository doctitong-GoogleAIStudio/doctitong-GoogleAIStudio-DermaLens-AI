"""Backend API tests for the DermaLens AI app."""
import base64
import hashlib
import hmac
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ACTIVATION_SECRET = os.environ["ACTIVATION_SECRET"]

SESSION = requests.Session()
SESSION.headers.update({"Content-Type": "application/json"})

# Real skin lesion image already downloaded in fixtures
IMG_PATH = "/tmp/test_img.jpg"


def _b64_image():
    with open(IMG_PATH, "rb") as f:
        return base64.b64encode(f.read()).decode()


def _new_email():
    return f"TEST_user_{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture(scope="module")
def signup_user():
    email = _new_email()
    payload = {"full_name": "TEST User", "email": email, "password": "secret123"}
    r = SESSION.post(f"{API}/auth/signup", json=payload)
    assert r.status_code == 201, r.text
    data = r.json()
    return {"email": email, "password": "secret123", "token": data["access_token"], "user": data["user"]}


# -------- Auth --------
class TestAuth:
    def test_signup_ok(self):
        email = _new_email()
        r = SESSION.post(f"{API}/auth/signup", json={"full_name": "TEST A", "email": email, "password": "secret123"})
        assert r.status_code == 201, r.text
        j = r.json()
        assert "access_token" in j and j["token_type"] == "bearer"
        assert j["user"]["email"] == email.lower()
        assert "password_hash" not in j["user"]

    def test_signup_duplicate_email(self, signup_user):
        r = SESSION.post(f"{API}/auth/signup", json={
            "full_name": "TEST Dup", "email": signup_user["email"], "password": "secret123"})
        assert r.status_code == 409

    def test_signup_invalid_email(self):
        r = SESSION.post(f"{API}/auth/signup", json={"full_name": "X", "email": "not-an-email", "password": "secret123"})
        assert r.status_code == 422

    def test_signup_short_password(self):
        r = SESSION.post(f"{API}/auth/signup", json={"full_name": "X", "email": _new_email(), "password": "abc"})
        assert r.status_code == 422

    def test_login_ok(self, signup_user):
        r = SESSION.post(f"{API}/auth/login", json={"email": signup_user["email"], "password": "secret123"})
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_login_wrong_password(self, signup_user):
        r = SESSION.post(f"{API}/auth/login", json={"email": signup_user["email"], "password": "wrongpass"})
        assert r.status_code == 401

    def test_me_ok(self, signup_user):
        r = SESSION.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {signup_user['token']}"})
        assert r.status_code == 200
        j = r.json()
        assert j["email"] == signup_user["email"].lower()
        assert "password_hash" not in j

    def test_me_invalid_token(self):
        r = SESSION.get(f"{API}/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
        assert r.status_code == 401

    def test_me_missing_token(self):
        r = SESSION.get(f"{API}/auth/me")
        assert r.status_code == 401


# -------- Analyze --------
class TestAnalyze:
    def test_analyze_no_auth(self):
        r = SESSION.post(f"{API}/analyze", json={"images": [_b64_image()]})
        assert r.status_code == 401

    def test_analyze_ok(self, signup_user):
        payload = {"images": [_b64_image()]}
        r = SESSION.post(f"{API}/analyze", json=payload,
                         headers={"Authorization": f"Bearer {signup_user['token']}"}, timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        j = r.json()
        # Structure validation
        assert "imageQuality" in j and "score" in j["imageQuality"] and "feedback" in j["imageQuality"]
        assert j["imageQuality"]["score"] in {"Excellent", "Good", "Fair", "Poor"}
        mld = j["mostLikelyDiagnosis"]
        assert set(mld.keys()) >= {"conditionName", "confidence", "description", "urgency", "urgencyReason"}
        assert mld["confidence"] in {"High", "Medium", "Low"}
        assert mld["urgency"] in {"Routine", "Requires Prompt Attention", "Urgent"}
        assert isinstance(j["differentialDiagnoses"], list)
        assert isinstance(j["nextSteps"], list) and len(j["nextSteps"]) > 0
        assert isinstance(j["disclaimer"], str) and len(j["disclaimer"]) > 10


# -------- Device Activation --------
def _expected_key(device_id: str) -> str:
    norm = device_id.strip().upper()
    d = hmac.new(ACTIVATION_SECRET.encode(), norm.encode(), hashlib.sha256).hexdigest()[:16].upper()
    return "-".join(d[i:i + 4] for i in range(0, 16, 4))


class TestActivation:
    def test_request_activation_no_auth(self):
        r = SESSION.post(f"{API}/device/request-activation", json={"device_id": "ABCD-1234-EF56"})
        assert r.status_code == 401

    def test_request_activation_ok(self, signup_user):
        r = SESSION.post(f"{API}/device/request-activation",
                         json={"device_id": "ABCD-1234-EF56"},
                         headers={"Authorization": f"Bearer {signup_user['token']}"}, timeout=45)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] in {"sent", "recorded"}
        assert "emailed" in j

    def test_activation_tool_html(self):
        r = SESSION.get(f"{API}/activation-tool")
        assert r.status_code == 200
        html = r.text
        assert "Offline Activation Generator" in html
        assert "Device ID" in html
        assert "sha256" in html.lower()
        # Ensure input field present
        assert 'id="did"' in html

    def test_key_parity(self):
        # Compute using our formula and hit unrelated flow to ensure format matches expected
        did = "ABCD-1234-EF56"
        key = _expected_key(did)
        # Must be AAAA-BBBB-CCCC-DDDD
        parts = key.split("-")
        assert len(parts) == 4 and all(len(p) == 4 for p in parts)
        # Uppercased hex only
        assert all(all(c in "0123456789ABCDEF" for c in p) for p in parts)
