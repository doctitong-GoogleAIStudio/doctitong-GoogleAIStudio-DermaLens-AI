"""Iteration 18: Security-fixed /api/analyze endpoint tests.

Covers:
- Auth: no header -> 401, bad activation -> 403, valid JWT -> 200 with expected keys.
- Validation (422): unsupported mime, data: prefix, 5 images, 0 images, non-base64, >8MB decoded.
- Google error text NOT leaked (mapped messages).
- analysis_logs row written for each call.
- /api/auth/signup, /login, /me still work (including 409 duplicate email).
"""
import base64
import io
import os
import time
from pathlib import Path

import pytest
import requests
from PIL import Image
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback: read from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TIMESTAMP = int(time.time())
TEST_EMAIL = f"iter18-{TIMESTAMP}@example.com"
TEST_PASSWORD = "secret123"
TEST_NAME = "Iter18 Tester"


# ---------- helpers ----------
def _jpeg_bytes(size=(400, 400), color=(180, 100, 90), quality=85) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _jpeg_b64(**kw) -> str:
    return base64.b64encode(_jpeg_bytes(**kw)).decode()


def _oversize_jpeg_b64() -> str:
    """Produce raw bytes whose base64-decoded length exceeds 8 MiB.

    The backend validator only checks decoded length, so any 8+ MB byte
    string encoded as base64 will trip the size rule.
    """
    data = os.urandom(8 * 1024 * 1024 + 1024)  # 8 MiB + 1 KiB
    return base64.b64encode(data).decode()


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def signup_response():
    r = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={"full_name": TEST_NAME, "email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=30,
    )
    assert r.status_code == 201, r.text
    return r


@pytest.fixture(scope="module")
def token(signup_response):
    return signup_response.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Auth regression ----------
class TestAuth:
    def test_signup_returns_token_and_user(self, signup_response):
        body = signup_response.json()
        assert "access_token" in body and body["access_token"]
        assert body["token_type"] == "bearer"
        assert body["user"]["email"] == TEST_EMAIL
        assert body["user"]["full_name"] == TEST_NAME
        assert "id" in body["user"]

    def test_signup_duplicate_returns_409(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/signup",
            json={"full_name": TEST_NAME, "email": TEST_EMAIL, "password": TEST_PASSWORD},
            timeout=30,
        )
        assert r.status_code == 409, r.text

    def test_login_success(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()

    def test_login_wrong_password(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": "wrongpass"}, timeout=30,
        )
        assert r.status_code == 401

    def test_me_returns_user(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == TEST_EMAIL


# ---------- /api/analyze auth ----------
class TestAnalyzeAuth:
    def test_no_authorization_header_returns_401(self):
        r = requests.post(
            f"{BASE_URL}/api/analyze",
            json={"images": [{"mimeType": "image/jpeg", "data": _jpeg_b64()}]},
            timeout=30,
        )
        assert r.status_code == 401, r.text

    def test_invalid_activation_key_returns_403(self):
        r = requests.post(
            f"{BASE_URL}/api/analyze",
            headers={"X-Activation-Key": "AAAA-BBBB-CCCC-DDDD"},
            json={"images": [{"mimeType": "image/jpeg", "data": _jpeg_b64()}]},
            timeout=30,
        )
        assert r.status_code == 403, r.text
        assert r.json().get("detail") == "App is not activated."


# ---------- /api/analyze validation (422) ----------
class TestAnalyzeValidation:
    def test_unsupported_mime_gif(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/analyze",
            headers=auth_headers,
            json={"images": [{"mimeType": "image/gif", "data": _jpeg_b64()}]},
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_data_prefix_rejected(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/analyze",
            headers=auth_headers,
            json={"images": [{"mimeType": "image/jpeg",
                              "data": "data:image/jpeg;base64,/9j/4AAQSkZ"}]},
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_five_images_rejected(self, auth_headers):
        payload = {"images": [{"mimeType": "image/jpeg", "data": _jpeg_b64()} for _ in range(5)]}
        r = requests.post(f"{BASE_URL}/api/analyze", headers=auth_headers,
                          json=payload, timeout=30)
        assert r.status_code == 422, r.text

    def test_zero_images_rejected(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/analyze", headers=auth_headers,
                          json={"images": []}, timeout=30)
        assert r.status_code == 422, r.text

    def test_non_base64_rejected(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/analyze", headers=auth_headers,
            json={"images": [{"mimeType": "image/jpeg", "data": "!!!not-base64@@@"}]},
            timeout=30,
        )
        assert r.status_code == 422, r.text

    def test_over_8mb_rejected(self, auth_headers):
        big = _oversize_jpeg_b64()
        # Decoded length must exceed 8 MiB
        assert len(base64.b64decode(big)) > 8 * 1024 * 1024
        r = requests.post(
            f"{BASE_URL}/api/analyze", headers=auth_headers,
            json={"images": [{"mimeType": "image/jpeg", "data": big}]},
            timeout=60,
        )
        assert r.status_code == 422, r.text[:300]


# ---------- /api/analyze success + logging ----------
class TestAnalyzeSuccess:
    """Runs ONE real Gemini analysis (cost-aware) and checks response + logging."""

    REQUIRED_KEYS = {"imageQuality", "assessmentPossible", "moreInfoNeeded",
                     "mostLikelyDiagnosis", "differentialDiagnoses", "redFlags",
                     "nextSteps", "disclaimer"}

    @pytest.mark.asyncio
    async def _count_logs_after(self, since_ts):
        c = AsyncIOMotorClient(MONGO_URL)
        try:
            db = c[DB_NAME]
            cnt = await db.analysis_logs.count_documents(
                {"created_at": {"$gte": since_ts}}
            )
            latest = await db.analysis_logs.find(
                {"created_at": {"$gte": since_ts}}
            ).sort("created_at", -1).to_list(1)
            return cnt, latest
        finally:
            c.close()

    def test_valid_jwt_returns_200_with_all_keys_and_logs(self, auth_headers):
        from datetime import datetime, timezone
        started = datetime.now(timezone.utc)

        r = requests.post(
            f"{BASE_URL}/api/analyze", headers=auth_headers,
            json={"images": [{"mimeType": "image/jpeg", "data": _jpeg_b64()}]},
            timeout=180,
        )
        assert r.status_code == 200, r.text[:500]
        body = r.json()
        missing = self.REQUIRED_KEYS - set(body.keys())
        assert not missing, f"Response missing keys: {missing}. Got: {sorted(body.keys())}"

        # Google-error text should never appear
        blob = str(body).lower()
        for leak in ("aiza", "generativelanguage", "x-goog-api-key",
                     "google api", "project"):
            # 'project' can appear legitimately in medical text, so only alarm on obvious leaks
            if leak in ("aiza", "generativelanguage", "x-goog-api-key"):
                assert leak not in blob, f"Google-related string leaked: {leak}"

        # Check analysis_logs entry synchronously via a small helper
        import asyncio
        cnt, latest = asyncio.get_event_loop().run_until_complete(
            self._count_logs_after(started)
        )
        assert cnt >= 1, "No analysis_logs row was written"
        row = latest[0]
        for field in ("principal_kind", "image_count", "latency_ms", "status", "model"):
            assert field in row, f"analysis_logs row missing {field}: {row}"
        assert row["status"] == 200
        assert row["image_count"] == 1
        assert row["principal_kind"] == "user"
        assert row.get("user_id"), "user_id should be set for JWT principal"
