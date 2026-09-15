"""Iteration 21 – Rate limit on /api/analyze (10 successful analyses per hour).

Tests:
1. After seeding 10 status=200 rows in analysis_logs for user A within the last hour,
   POST /api/analyze -> 429 with the exact detail string.
2. Deleting the rows re-opens the gate for user A (proof-of-open: a 422 validation
   error from an intentionally empty body is enough – do NOT burn a real Gemini call).
3. Isolation: rows for user A must not affect user B.
"""
import os
import time
import base64
import requests
import pytest
from datetime import datetime, timezone
from pymongo import MongoClient
from bson import ObjectId

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="module")
def db():
    # backend .env is the source of truth
    from pathlib import Path
    for line in Path("/app/backend/.env").read_text().splitlines():
        if line.startswith("MONGO_URL="):
            mongo_url = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("DB_NAME="):
            db_name = line.split("=", 1)[1].strip().strip('"')
    client = MongoClient(mongo_url)
    yield client[db_name]
    client.close()


def _signup(email_suffix: str):
    email = f"TEST_rl_{email_suffix}_{int(time.time())}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/signup",
        json={"full_name": "TEST Rate Limit", "email": email, "password": "secret123"},
        timeout=30,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    return data["access_token"], data["user"]["id"], email


@pytest.fixture(scope="module")
def user_a():
    token, uid, email = _signup("a")
    return {"token": token, "id": uid, "email": email}


@pytest.fixture(scope="module")
def user_b():
    token, uid, email = _signup("b")
    return {"token": token, "id": uid, "email": email}


def _seed_logs(db, user_id: str, n: int):
    now = datetime.now(timezone.utc)
    docs = [
        {
            "principal_kind": "user",
            "user_id": user_id,
            "activation_device_id": None,
            "image_count": 1,
            "latency_ms": 100,
            "status": 200,
            "model": "gemini-3.1-pro-preview",
            "created_at": now,
            "_test_seed": True,
        }
        for _ in range(n)
    ]
    db.analysis_logs.insert_many(docs)


def _clean_logs(db, user_id: str):
    db.analysis_logs.delete_many({"user_id": user_id, "_test_seed": True})


# tiny valid 1x1 jpeg to satisfy validators (still costs a gemini call if it goes through
# — but we only send this when the gate is CLOSED, so it will 429 before Gemini is called)
TINY_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/"
    "2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUB"
    "AQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJico"
    "KSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2u"
    "Hi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEI"
    "FEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqK"
    "mqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q=="
)


class TestRateLimit:
    def test_signup_ok(self, user_a):
        assert user_a["id"]
        assert user_a["token"]

    def test_hits_limit_after_10_logs(self, db, user_a):
        _clean_logs(db, user_a["id"])
        _seed_logs(db, user_a["id"], 10)
        r = requests.post(
            f"{BASE_URL}/api/analyze",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={"images": [{"mimeType": "image/jpeg", "data": TINY_JPEG_B64}]},
            timeout=30,
        )
        assert r.status_code == 429, f"Expected 429, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", "")
        assert detail == "You have reached the limit of 10 analyses per hour. Please try again later.", detail

    def test_gate_reopens_after_cleanup(self, db, user_a):
        _clean_logs(db, user_a["id"])
        # send an INVALID body → 422 (validation) proves rate-limit gate is OPEN
        # without burning a real Gemini call.
        r = requests.post(
            f"{BASE_URL}/api/analyze",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={"images": []},  # min_length=1 → validation error
            timeout=30,
        )
        assert r.status_code == 422, f"Expected 422 (gate open), got {r.status_code}: {r.text}"

    def test_isolation_user_b_not_limited(self, db, user_a, user_b):
        # Re-seed A to the cap
        _clean_logs(db, user_a["id"])
        _clean_logs(db, user_b["id"])
        _seed_logs(db, user_a["id"], 10)
        # user B should NOT be rate-limited
        r = requests.post(
            f"{BASE_URL}/api/analyze",
            headers={"Authorization": f"Bearer {user_b['token']}"},
            json={"images": []},
            timeout=30,
        )
        assert r.status_code != 429, f"User B was rate-limited: {r.status_code} {r.text}"
        # 422 is the expected gate-open signal
        assert r.status_code == 422, r.text
        _clean_logs(db, user_a["id"])

    def test_indexes_exist(self, db):
        idx = db.analysis_logs.index_information()
        keys = [tuple(v["key"]) for v in idx.values()]
        assert (("user_id", 1), ("created_at", -1)) in keys, keys
        assert (("activation_device_id", 1), ("created_at", -1)) in keys, keys
