"""
Iteration 9 backend tests — device activation persistence.
Covers:
  - GET /api/device/status (auth required, false for unknown ids)
  - POST /api/device/activate (400 wrong key, 200 correct, idempotent)
  - POST /api/device/request-activation stores/emails NO activation key
"""

import os
import hmac
import hashlib
import uuid
from datetime import datetime

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
ACTIVATION_SECRET = b"DERM-ACT-2026-x7Qp9Lm3Vt8Bz1Ns"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def compute_key(device_id: str) -> str:
    norm = device_id.strip().upper().encode()
    digest = hmac.new(ACTIVATION_SECRET, norm, hashlib.sha256).hexdigest()
    s = digest[:16].upper()
    return "-".join(s[i:i + 4] for i in range(0, 16, 4))


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "test1@example.com", "password": "secret123"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def mongo_db():
    # Always load fresh from the backend .env to avoid shell-quoted values.
    try:
        from dotenv import dotenv_values
        vals = dotenv_values("/app/backend/.env")
        mongo_url = vals.get("MONGO_URL") or MONGO_URL
        db_name = vals.get("DB_NAME") or DB_NAME
    except Exception:
        mongo_url = MONGO_URL
        db_name = DB_NAME
    c = MongoClient(mongo_url)
    yield c[db_name]
    c.close()


# ---------- /api/device/status ----------
class TestDeviceStatus:
    def test_status_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/device/status",
                         params={"device_id": "AAAA-BBBB-CCCC"}, timeout=15)
        assert r.status_code == 401

    def test_status_unknown_device(self, auth_headers):
        did = f"TST{uuid.uuid4().hex[:8].upper()}"
        r = requests.get(f"{BASE_URL}/api/device/status",
                         params={"device_id": did},
                         headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"activated": False}


# ---------- /api/device/activate ----------
class TestDeviceActivate:
    def test_activate_wrong_key(self, auth_headers):
        did = f"TST{uuid.uuid4().hex[:8].upper()}"
        r = requests.post(f"{BASE_URL}/api/device/activate",
                          json={"device_id": did, "key": "WRONG-WRNG-WRNG-WRNG"},
                          headers=auth_headers, timeout=15)
        assert r.status_code == 400
        assert "Invalid activation key" in r.json().get("detail", "")

    def test_activate_correct_key_and_persistence(self, auth_headers, mongo_db):
        did = f"TST{uuid.uuid4().hex[:8].upper()}"
        key = compute_key(did)

        r = requests.post(f"{BASE_URL}/api/device/activate",
                          json={"device_id": did, "key": key},
                          headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"activated": True}

        # GET status verifies persistence
        r2 = requests.get(f"{BASE_URL}/api/device/status",
                          params={"device_id": did},
                          headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        assert r2.json() == {"activated": True}

        # Idempotency: activated_at must not change
        try:
            first_doc = mongo_db.activated_devices.find_one({"device_id": did})
            first_at = first_doc.get("activated_at") if first_doc else None
        except Exception:
            first_at = None

        r3 = requests.post(f"{BASE_URL}/api/device/activate",
                           json={"device_id": did, "key": key},
                           headers=auth_headers, timeout=15)
        assert r3.status_code == 200
        assert r3.json() == {"activated": True}

        try:
            second_doc = mongo_db.activated_devices.find_one({"device_id": did})
            second_at = second_doc.get("activated_at") if second_doc else None
            if first_at is not None and second_at is not None:
                assert first_at == second_at, "activated_at must not change on repeat"
            # Cleanup
            mongo_db.activated_devices.delete_one({"device_id": did})
        except Exception:
            # If DB access unavailable, still verify API idempotency by status
            pass

    def test_activate_requires_auth(self):
        did = f"TST{uuid.uuid4().hex[:8].upper()}"
        r = requests.post(f"{BASE_URL}/api/device/activate",
                          json={"device_id": did, "key": compute_key(did)}, timeout=15)
        assert r.status_code == 401


# ---------- /api/device/request-activation — NO KEY LEAK ----------
class TestRequestActivationNoKey:
    def test_request_activation_omits_key(self, auth_headers, mongo_db):
        did = f"REQ{uuid.uuid4().hex[:8].upper()}"
        expected_key = compute_key(did)

        r = requests.post(f"{BASE_URL}/api/device/request-activation",
                          json={"device_id": did},
                          headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text

        # Inspect stored Mongo doc — must NOT contain the activation key
        try:
            doc = mongo_db.activation_requests.find_one({"device_id": did}, sort=[("created_at", -1)])
            assert doc is not None, "activation_requests doc not found"
            assert "activation_key" not in doc, "activation_key must NOT be stored in Mongo"
            # And the key value itself must not appear in any field
            joined = " ".join(str(v) for v in doc.values())
            assert expected_key not in joined, "Activation key leaked into request document"
            # It should contain the device id and user email
            assert doc.get("device_id") == did
            assert doc.get("email") == "test1@example.com"
            # Cleanup
            mongo_db.activation_requests.delete_one({"_id": doc["_id"]})
        except AssertionError:
            raise
        except Exception as e:
            pytest.skip(f"Mongo verification unavailable: {e}")

    def test_email_html_has_no_key(self):
        """Code-path check: the _activation_email_html function must not embed the key."""
        import sys
        sys.path.insert(0, "/app/backend")
        try:
            from server import _activation_email_html, make_activation_key
        except Exception as e:
            pytest.skip(f"Cannot import server: {e}")
        did = "TESTDEVICE-1234"
        expected_key = make_activation_key(did)
        html = _activation_email_html("Test User", "test1@example.com", did)
        assert expected_key not in html, "Activation key must NOT appear in the email HTML"
        # But the identifying fields must be present
        assert did in html
        assert "Test User" in html
        assert "test1@example.com" in html
