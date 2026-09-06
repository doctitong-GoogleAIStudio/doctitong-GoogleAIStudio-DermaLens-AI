"""Iteration 3 backend regression — quick 3-endpoint 200 check.

Endpoints under review:
  * POST /api/auth/login
  * GET  /api/auth/me
  * GET  /api/activation-tool
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://ai-dermatologist-app.preview.emergentagent.com"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(api):
    r = api.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "test1@example.com", "password": "secret123"},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok and "user" in data
    return tok


# --- auth ---
def test_login_200(api):
    r = api.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "test1@example.com", "password": "secret123"},
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "test1@example.com"
    tok = body.get("access_token") or body.get("token")
    assert isinstance(tok, str) and len(tok) > 10


def test_me_200(api, token):
    r = api.get(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "test1@example.com"


# --- activation tool (offline generator HTML) ---
def test_activation_tool_200(api):
    r = api.get(f"{BASE_URL}/api/activation-tool", timeout=15)
    assert r.status_code == 200
    assert "text/html" in r.headers.get("content-type", "")
    # sanity: page contains the tool name / a hint text
    assert "Activation" in r.text or "activation" in r.text
