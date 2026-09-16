"""Iteration 22 – Account deletion, public pages, subscription verification.

Tests (run against the live preview backend, like the other iteration suites):
1. POST /api/account/delete (JWT) with the wrong password -> 401, account untouched.
2. POST /api/account/delete with the right password -> 200 {deleted:true}; afterwards
   /api/auth/me is 401 (token revoked because the user is gone), /api/auth/login is 401,
   the users row is gone, analysis_logs rows are de-identified, activation_requests are gone,
   an account_deletions row with sha256(email) exists.
3. POST /api/account-deletion (no JWT, email+password — the web page path) -> 200 and the
   same server-side effects; unknown email -> 404; wrong password -> 401.
4. POST /api/account-deletion/request -> 202 for both existing and unknown addresses.
5. GET /api/account-deletion and GET /api/privacy-policy return HTML that names
   DermaLens AI + aivicventures and no old branding.
6. POST /api/billing/subscription returns {configured:false} when no service account is set
   (or a well-formed summary when it is) and 401 without a token.
"""
import hashlib
import os
import time
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = "secret123"


@pytest.fixture(scope="module")
def db():
    from pymongo import MongoClient

    client = MongoClient(os.environ["MONGO_URL"])
    yield client[os.environ["DB_NAME"]]
    client.close()


def _signup(tag: str):
    email = f"TEST_del_{tag}_{int(time.time() * 1000)}@example.com".lower()
    r = requests.post(f"{API}/auth/signup", json={"full_name": "TEST Delete", "email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    j = r.json()
    return email, j["access_token"], j["user"]["id"]


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


class TestInAppDeletion:
    def test_wrong_password_is_rejected(self, db):
        email, token, user_id = _signup("wrongpw")
        r = requests.post(f"{API}/account/delete", json={"password": "not-it"}, headers=_auth(token))
        assert r.status_code == 401, r.text
        assert db.users.find_one({"email": email}) is not None
        # still signed in
        assert requests.get(f"{API}/auth/me", headers=_auth(token)).status_code == 200

    def test_requires_token(self):
        r = requests.post(f"{API}/account/delete", json={"password": PASSWORD})
        assert r.status_code == 401

    def test_deletes_everything_and_revokes_session(self, db):
        from bson import ObjectId
        from datetime import datetime, timezone

        email, token, user_id = _signup("full")
        now = datetime.now(timezone.utc)
        db.analysis_logs.insert_one({"principal_kind": "user", "user_id": user_id, "image_count": 1,
                                     "latency_ms": 10, "status": 200, "model": "x", "created_at": now})
        db.activation_requests.insert_one({"user_id": user_id, "full_name": "TEST Delete", "email": email,
                                           "device_id": "TEST-DEL-0001", "created_at": now})
        db.activated_devices.insert_one({"device_id": "TEST-DEL-0001", "activated_at": now,
                                         "activated_by_email": email, "activated_by_name": "TEST Delete"})

        r = requests.post(f"{API}/account/delete", json={"password": PASSWORD}, headers=_auth(token))
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] is True

        assert db.users.find_one({"_id": ObjectId(user_id)}) is None
        assert requests.get(f"{API}/auth/me", headers=_auth(token)).status_code == 401
        assert requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401
        assert requests.get(f"{API}/auth/email-exists", params={"email": email}).json()["exists"] is False

        assert db.analysis_logs.count_documents({"user_id": user_id}) == 0
        assert db.analysis_logs.count_documents({"deleted_user": True, "user_id": None}) >= 1
        assert db.activation_requests.count_documents({"user_id": user_id}) == 0
        dev = db.activated_devices.find_one({"device_id": "TEST-DEL-0001"})
        assert dev is not None and "activated_by_email" not in dev and "activated_by_name" not in dev
        assert dev.get("activator_deleted_at") is not None

        rec = db.account_deletions.find_one({"email_hash": hashlib.sha256(email.encode()).hexdigest()})
        assert rec is not None and rec["source"] == "app"

        db.activated_devices.delete_one({"device_id": "TEST-DEL-0001"})


class TestWebPageDeletion:
    def test_unknown_email_404(self):
        r = requests.post(f"{API}/account-deletion", json={"email": "nobody_test_del@example.com", "password": "x"})
        assert r.status_code == 404

    def test_wrong_password_401(self):
        email, _, _ = _signup("webwrong")
        r = requests.post(f"{API}/account-deletion", json={"email": email, "password": "nope"})
        assert r.status_code == 401

    def test_deletes_with_credentials(self, db):
        email, token, user_id = _signup("web")
        r = requests.post(f"{API}/account-deletion", json={"email": email.upper(), "password": PASSWORD})
        assert r.status_code == 200, r.text
        assert db.users.find_one({"email": email}) is None
        assert requests.get(f"{API}/auth/me", headers=_auth(token)).status_code == 401
        rec = db.account_deletions.find_one({"email_hash": hashlib.sha256(email.encode()).hexdigest()})
        assert rec is not None and rec["source"] == "web"

    def test_request_form_is_always_202(self, db):
        email, _, _ = _signup("req")
        r = requests.post(f"{API}/account-deletion/request", json={"email": email, "note": "lost my phone"})
        assert r.status_code == 202 and r.json()["status"] == "received"
        r2 = requests.post(f"{API}/account-deletion/request", json={"email": "ghost_test_del@example.com"})
        assert r2.status_code == 202
        row = db.account_deletion_requests.find_one({"email": email})
        assert row and row["account_exists"] is True and row["status"] == "open"
        db.account_deletion_requests.delete_many({"email": {"$in": [email, "ghost_test_del@example.com"]}})


class TestPublicPages:
    def test_account_deletion_page(self):
        r = requests.get(f"{API}/account-deletion")
        assert r.status_code == 200 and "text/html" in r.headers["content-type"]
        assert "DermaLens AI" in r.text and "aivicventures" in r.text
        assert "Delete My Account and Data" in r.text
        assert "play.google.com/store/account/subscriptions" in r.text
        assert "AI Dermatologist" not in r.text and "Cavalida" not in r.text

    def test_privacy_policy_page(self):
        r = requests.get(f"{API}/privacy-policy")
        assert r.status_code == 200 and "text/html" in r.headers["content-type"]
        for needle in ("DermaLens AI", "aivicventures", "Retention", "Google Play", "account-deletion"):
            assert needle in r.text, needle
        assert "AI Dermatologist" not in r.text and "Cavalida" not in r.text
        assert "{{" not in r.text  # every placeholder substituted

    def test_root_branding(self):
        assert requests.get(f"{API}/").json()["message"] == "DermaLens AI API"


class TestSubscriptionVerification:
    def test_requires_token(self):
        r = requests.post(f"{API}/billing/subscription", json={"productId": "premium_monthly", "purchaseToken": "x" * 20})
        assert r.status_code == 401

    def test_unconfigured_or_summary(self):
        _, token, _ = _signup("sub")
        r = requests.post(f"{API}/billing/subscription", json={"productId": "premium_monthly", "purchaseToken": "x" * 20},
                          headers=_auth(token))
        if not os.environ.get("PLAY_SERVICE_ACCOUNT_JSON"):
            assert r.status_code == 200 and r.json() == {"configured": False}
        else:
            # A bogus token must come back as a clean "none" summary, never a raw Google error.
            assert r.status_code in (200, 502), r.text
            if r.status_code == 200:
                assert r.json()["configured"] is True and "state" in r.json()

    def test_validation(self):
        _, token, _ = _signup("subval")
        r = requests.post(f"{API}/billing/subscription", json={"productId": "", "purchaseToken": "short"}, headers=_auth(token))
        assert r.status_code == 422


class TestBillingUsage:
    """GET /api/billing/usage — account-bound free-analysis counter (survives reinstall)."""

    def test_requires_token(self):
        assert requests.get(f"{API}/billing/usage").status_code == 401

    def test_counts_successful_analyses_per_account(self, db):
        from datetime import datetime, timezone

        _, token, user_id = _signup("usage")
        r = requests.get(f"{API}/billing/usage", headers=_auth(token))
        assert r.status_code == 200 and r.json()["analyses_used"] == 0
        assert r.json()["free_analyses"] >= 1

        now = datetime.now(timezone.utc)
        db.analysis_logs.insert_many([
            {"principal_kind": "user", "user_id": user_id, "image_count": 1, "latency_ms": 1, "status": 200, "model": "x", "created_at": now},
            {"principal_kind": "user", "user_id": user_id, "image_count": 1, "latency_ms": 1, "status": 502, "model": "x", "created_at": now},
        ])
        r = requests.get(f"{API}/billing/usage", headers=_auth(token))
        assert r.json()["analyses_used"] == 1  # failed analyses do not count
        db.analysis_logs.delete_many({"user_id": user_id})
