"""Iteration 2 regression: quick 200-checks on the 4 backend endpoints.
- POST /api/auth/login (test1@example.com / secret123)
- GET  /api/auth/me
- POST /api/device/request-activation
- GET  /api/activation-tool (HTML content + key parity for known device)
"""
import os
import hmac
import hashlib
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ACTIVATION_SECRET = os.environ["ACTIVATION_SECRET"]

S = requests.Session()
S.headers.update({"Content-Type": "application/json"})


@pytest.fixture(scope="module")
def token():
    r = S.post(f"{API}/auth/login", json={"email": "test1@example.com", "password": "secret123"}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    assert "access_token" in j
    assert j["user"]["email"].lower() == "test1@example.com"
    return j["access_token"]


def test_login_regression():
    r = S.post(f"{API}/auth/login", json={"email": "test1@example.com", "password": "secret123"})
    assert r.status_code == 200
    j = r.json()
    assert j["token_type"] == "bearer"
    assert "password_hash" not in j["user"]


def test_me_regression(token):
    r = S.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    j = r.json()
    assert j["email"] == "test1@example.com"
    assert "password_hash" not in j
    assert "id" in j and "full_name" in j


def test_request_activation_regression(token):
    r = S.post(
        f"{API}/device/request-activation",
        json={"device_id": "1FE4-820B-D0DF"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=45,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] in {"sent", "recorded"}
    assert "emailed" in j


def test_activation_tool_html_regression():
    r = S.get(f"{API}/activation-tool")
    assert r.status_code == 200
    html = r.text
    assert "Offline Activation Generator" in html
    assert "sha256" in html.lower()
    # The correct secret is embedded (needed for offline generation)
    assert ACTIVATION_SECRET in html


def test_activation_tool_known_key_parity():
    """Confirm the algorithm produces 96CD-C305-CAED-0551 for 1FE4-820B-D0DF."""
    did = "1FE4-820B-D0DF"
    d = hmac.new(ACTIVATION_SECRET.encode(), did.encode(), hashlib.sha256).hexdigest()[:16].upper()
    key = "-".join(d[i:i + 4] for i in range(0, 16, 4))
    assert key == "96CD-C305-CAED-0551", f"unexpected key: {key}"
