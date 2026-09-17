#!/usr/bin/env python3
"""
Comprehensive test suite for the NEW email-verified sign-up flow (v1.1.5).
Tests all 24 items from the review request.
"""

import hashlib
import json
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

# Configuration
BASE_URL = "https://github-file-copier.preview.emergentagent.com/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
JWT_SECRET = "b09c6cb11ccbe4c3a48e383247020e3c7833ef3b7930b0d60626799652d69824"

# Test results
results = []
cleanup_emails = []


def log_result(test_num: int, description: str, passed: bool, details: str = ""):
    """Log a test result."""
    status = "✅ PASS" if passed else "❌ FAIL"
    result = {
        "test": test_num,
        "description": description,
        "status": status,
        "passed": passed,
        "details": details,
    }
    results.append(result)
    print(f"\n{status} Test {test_num}: {description}")
    if details:
        print(f"  Details: {details}")


def normalized_email(email: str) -> str:
    """Normalize email like the backend does."""
    return email.strip().lower()


def code_hash(email: str, code: str) -> str:
    """Generate code hash exactly like the backend."""
    return hashlib.sha256(
        f"{normalized_email(email)}:{code.strip()}:{JWT_SECRET}".encode()
    ).hexdigest()


def get_mongo_client():
    """Get synchronous MongoDB client."""
    return MongoClient(MONGO_URL)


def cleanup_pending_signup(email: str):
    """Remove pending signup doc."""
    client = get_mongo_client()
    db = client[DB_NAME]
    db.pending_signups.delete_one({"email": normalized_email(email)})
    client.close()


def cleanup_user(email: str):
    """Remove user doc."""
    client = get_mongo_client()
    db = client[DB_NAME]
    db.users.delete_one({"email": normalized_email(email)})
    client.close()


def cleanup_signup_sends(email: str):
    """Remove signup code sends for an email."""
    client = get_mongo_client()
    db = client[DB_NAME]
    db.signup_code_sends.delete_many({"email": normalized_email(email)})
    client.close()


def set_pending_code(email: str, code: str):
    """Set a known code hash on a pending signup doc."""
    client = get_mongo_client()
    db = client[DB_NAME]
    db.pending_signups.update_one(
        {"email": normalized_email(email)},
        {"$set": {"code_hash": code_hash(email, code)}},
    )
    client.close()


def get_pending_signup(email: str) -> Optional[Dict[str, Any]]:
    """Get pending signup doc."""
    client = get_mongo_client()
    db = client[DB_NAME]
    doc = db.pending_signups.find_one({"email": normalized_email(email)})
    client.close()
    return doc


def get_user(email: str) -> Optional[Dict[str, Any]]:
    """Get user doc."""
    client = get_mongo_client()
    db = client[DB_NAME]
    doc = db.users.find_one({"email": normalized_email(email)})
    client.close()
    return doc


def count_signup_sends(email: str) -> int:
    """Count signup code sends for an email in the last hour."""
    client = get_mongo_client()
    db = client[DB_NAME]
    since = datetime.now(timezone.utc) - timedelta(hours=1)
    count = db.signup_code_sends.count_documents(
        {"email": normalized_email(email), "created_at": {"$gte": since}}
    )
    client.close()
    return count


def set_last_sent_at(email: str, minutes_ago: int):
    """Set last_sent_at to X minutes ago."""
    client = get_mongo_client()
    db = client[DB_NAME]
    past = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    db.pending_signups.update_one(
        {"email": normalized_email(email)}, {"$set": {"last_sent_at": past}}
    )
    client.close()


def set_resends(email: str, count: int):
    """Set resends count on pending doc."""
    client = get_mongo_client()
    db = client[DB_NAME]
    db.pending_signups.update_one(
        {"email": normalized_email(email)}, {"$set": {"resends": count}}
    )
    client.close()


def set_expires_at(email: str, minutes_from_now: int):
    """Set expires_at to X minutes from now (negative = past)."""
    client = get_mongo_client()
    db = client[DB_NAME]
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)
    db.pending_signups.update_one(
        {"email": normalized_email(email)}, {"$set": {"expires_at": exp}}
    )
    client.close()


# =============================================================================
# A) POST /api/auth/signup/start
# =============================================================================


def test_a1_valid_deliverable_address():
    """Test 1: Valid, deliverable address -> 200 with expected JSON."""
    email = f"dermatest+{int(time.time())}@gmail.com"
    cleanup_emails.append(email)

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Test User",
                "email": email,
                "password": "TestPass123!",
            },
        )

    if resp.status_code == 200:
        data = resp.json()
        passed = (
            data.get("sent") is True
            and data.get("email") == normalized_email(email)
            and data.get("expires_in_seconds") == 600
            and data.get("resend_after_seconds") == 60
        )
        log_result(
            1,
            "Valid deliverable address",
            passed,
            f"Status: {resp.status_code}, JSON: {json.dumps(data, indent=2)}",
        )

        # Check pending doc
        pending = get_pending_signup(email)
        if pending:
            has_code_hash = "code_hash" in pending and pending["code_hash"]
            has_no_plaintext = "code" not in pending
            has_password_hash = "password_hash" in pending and pending["password_hash"]
            has_attempts = pending.get("attempts") == 0
            has_expires = "expires_at" in pending

            log_result(
                1.1,
                "Pending doc created correctly",
                has_code_hash
                and has_no_plaintext
                and has_password_hash
                and has_attempts
                and has_expires,
                f"code_hash present: {has_code_hash}, no plaintext code: {has_no_plaintext}, "
                f"password_hash present: {has_password_hash}, attempts: {pending.get('attempts')}, "
                f"expires_at present: {has_expires}",
            )
        else:
            log_result(1.1, "Pending doc created", False, "No pending doc found")
    else:
        log_result(
            1,
            "Valid deliverable address",
            False,
            f"Status: {resp.status_code}, Body: {resp.text}",
        )


def test_a2_no_user_created():
    """Test 2: Confirm NO user row was created at this point."""
    # Use the email from test 1
    if cleanup_emails:
        email = cleanup_emails[0]
        user = get_user(email)
        passed = user is None
        log_result(
            2,
            "No user row created before verification",
            passed,
            f"User exists: {user is not None}",
        )
    else:
        log_result(2, "No user row created before verification", False, "No test email")


def test_a3_malformed_emails():
    """Test 3: Malformed emails -> 422."""
    malformed = [
        "plainaddress",
        "a@b",
        "jane@company",
        "a..b@gmail.com",
        f"{'a' * 70}@gmail.com",  # 70-char local part
    ]

    all_passed = True
    details = []

    for email in malformed:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/start",
                json={"full_name": "Test", "email": email, "password": "TestPass123!"},
            )

        passed = resp.status_code == 422
        all_passed = all_passed and passed
        details.append(f"{email}: {resp.status_code}")

    log_result(3, "Malformed emails -> 422", all_passed, ", ".join(details))


def test_a4_disposable_domains():
    """Test 4: Disposable domains -> 400 with specific message."""
    disposable = [
        "test@mailinator.com",
        "test@yopmail.com",
        "test@guerrillamail.com",
        "test@10minutemail.com",
        "test@foo.mailinator.com",  # subdomain
    ]

    all_passed = True
    details = []

    for email in disposable:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/start",
                json={"full_name": "Test", "email": email, "password": "TestPass123!"},
            )

        passed = resp.status_code == 400 and "Temporary or disposable" in resp.text
        all_passed = all_passed and passed
        details.append(f"{email}: {resp.status_code} - {resp.json().get('detail', '')}")

    log_result(
        4, "Disposable domains -> 400", all_passed, "\n    ".join(details)
    )


def test_a5_reserved_names():
    """Test 5: RFC-reserved names -> 400."""
    reserved = ["test@dermalens.test", "test@example.com"]

    all_passed = True
    details = []

    for email in reserved:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/start",
                json={"full_name": "Test", "email": email, "password": "TestPass123!"},
            )

        passed = resp.status_code == 400
        all_passed = all_passed and passed
        details.append(f"{email}: {resp.status_code} - {resp.json().get('detail', '')}")

    log_result(5, "RFC-reserved names -> 400", all_passed, "\n    ".join(details))


def test_a6_no_mail_server():
    """Test 6: Domain with no mail server -> 400."""
    email = "test@thisdomaindoesnotexist-zzz12345.com"

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={"full_name": "Test", "email": email, "password": "TestPass123!"},
        )

    passed = resp.status_code == 400 and "cannot receive mail" in resp.text
    log_result(
        6,
        "Domain with no mail server -> 400",
        passed,
        f"Status: {resp.status_code}, Message: {resp.json().get('detail', '')}",
    )


def test_a7_short_password():
    """Test 7: Password shorter than 8 characters -> 422."""
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Test",
                "email": "test@gmail.com",
                "password": "short",
            },
        )

    passed = resp.status_code == 422
    log_result(
        7,
        "Password < 8 chars -> 422",
        passed,
        f"Status: {resp.status_code}, Body: {resp.text[:200]}",
    )


def test_a8_existing_email():
    """Test 8: Email that already has an account -> 409."""
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Test",
                "email": "testdoctor@dermalens.com",
                "password": "TestPass123!",
            },
        )

    passed = resp.status_code == 409
    log_result(
        8,
        "Existing email -> 409",
        passed,
        f"Status: {resp.status_code}, Message: {resp.json().get('detail', '')}",
    )


def test_a9_rate_limit():
    """Test 9: Rate limit - 6 calls for same address -> 6th is 429."""
    email = f"ratelimit+{int(time.time())}@gmail.com"
    cleanup_emails.append(email)

    # Clear any existing sends
    cleanup_signup_sends(email)

    statuses = []
    for i in range(6):
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/start",
                json={
                    "full_name": "Test",
                    "email": email,
                    "password": "TestPass123!",
                },
            )
        statuses.append(resp.status_code)
        time.sleep(0.5)  # Small delay between requests

    # First 5 should be 200, 6th should be 429
    passed = statuses[:5] == [200] * 5 and statuses[5] == 429
    log_result(
        9,
        "Rate limit (6th call -> 429)",
        passed,
        f"Statuses: {statuses}",
    )

    # Clean up
    cleanup_signup_sends(email)
    cleanup_pending_signup(email)


# =============================================================================
# B) POST /api/auth/signup/verify
# =============================================================================


def test_b10_wrong_code():
    """Test 10: Wrong code -> 400 with remaining attempts."""
    email = f"wrongcode+{int(time.time())}@gmail.com"
    cleanup_emails.append(email)

    # Start signup
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Test",
                "email": email,
                "password": "TestPass123!",
            },
        )

    if resp.status_code == 200:
        # Try wrong code
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/verify",
                json={"email": email, "code": "999999"},
            )

        passed = resp.status_code == 400 and "4 attempts left" in resp.text
        log_result(
            10,
            "Wrong code -> 400 with attempts",
            passed,
            f"Status: {resp.status_code}, Message: {resp.json().get('detail', '')}",
        )
    else:
        log_result(10, "Wrong code -> 400 with attempts", False, "Start failed")


def test_b11_correct_code():
    """Test 11: Correct code (via hash trick) -> 201 with token."""
    email = f"correctcode+{int(time.time())}@gmail.com"
    cleanup_emails.append(email)

    # Start signup
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Correct Test",
                "email": email,
                "password": "TestPass123!",
            },
        )

    if resp.status_code == 200:
        # Set known code
        set_pending_code(email, "123456")

        # Verify with known code
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/verify",
                json={"email": email, "code": "123456"},
            )

        if resp.status_code == 201:
            data = resp.json()
            has_token = "access_token" in data
            has_user = "user" in data

            # Check user doc
            user = get_user(email)
            email_verified = user and user.get("email_verified") is True

            # Check pending doc deleted
            pending = get_pending_signup(email)
            pending_deleted = pending is None

            passed = has_token and has_user and email_verified and pending_deleted
            log_result(
                11,
                "Correct code -> 201 with token",
                passed,
                f"Has token: {has_token}, Has user: {has_user}, "
                f"email_verified: {email_verified}, Pending deleted: {pending_deleted}",
            )
        else:
            log_result(
                11,
                "Correct code -> 201 with token",
                False,
                f"Status: {resp.status_code}, Body: {resp.text}",
            )
    else:
        log_result(11, "Correct code -> 201 with token", False, "Start failed")


def test_b12_login_after_signup():
    """Test 12: New account can log in."""
    # Use email from test 11
    if len(cleanup_emails) >= 3:
        email = cleanup_emails[2]  # correctcode email

        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/login",
                json={"email": email, "password": "TestPass123!"},
            )

        passed = resp.status_code == 200 and "access_token" in resp.json()
        log_result(
            12,
            "New account can log in",
            passed,
            f"Status: {resp.status_code}",
        )
    else:
        log_result(12, "New account can log in", False, "No test email")


def test_b13_five_wrong_codes():
    """Test 13: Five wrong codes -> 429 and pending doc deleted."""
    email = f"fivewrong+{int(time.time())}@gmail.com"
    cleanup_emails.append(email)

    # Start signup
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Test",
                "email": email,
                "password": "TestPass123!",
            },
        )

    if resp.status_code == 200:
        # Try 5 wrong codes
        last_status = None
        for i in range(5):
            with httpx.Client(timeout=30) as client:
                resp = client.post(
                    f"{BASE_URL}/auth/signup/verify",
                    json={"email": email, "code": f"99999{i}"},
                )
            last_status = resp.status_code

        # Check pending doc deleted
        pending = get_pending_signup(email)
        pending_deleted = pending is None

        passed = last_status == 429 and pending_deleted
        log_result(
            13,
            "Five wrong codes -> 429 and doc deleted",
            passed,
            f"Last status: {last_status}, Pending deleted: {pending_deleted}",
        )
    else:
        log_result(13, "Five wrong codes -> 429 and doc deleted", False, "Start failed")


def test_b14_expired_code():
    """Test 14: Expired code -> 400 and doc removed."""
    email = f"expired+{int(time.time())}@gmail.com"
    cleanup_emails.append(email)

    # Start signup
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Test",
                "email": email,
                "password": "TestPass123!",
            },
        )

    if resp.status_code == 200:
        # Set expires_at to past
        set_expires_at(email, -1)

        # Try to verify
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/verify",
                json={"email": email, "code": "123456"},
            )

        # Check pending doc deleted
        pending = get_pending_signup(email)
        pending_deleted = pending is None

        passed = resp.status_code == 400 and "expired" in resp.text.lower() and pending_deleted
        log_result(
            14,
            "Expired code -> 400 and doc removed",
            passed,
            f"Status: {resp.status_code}, Message: {resp.json().get('detail', '')}, "
            f"Pending deleted: {pending_deleted}",
        )
    else:
        log_result(14, "Expired code -> 400 and doc removed", False, "Start failed")


def test_b15_no_pending_doc():
    """Test 15: Verify with no pending doc -> 400."""
    email = f"nopending+{int(time.time())}@gmail.com"

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/verify",
            json={"email": email, "code": "123456"},
        )

    passed = resp.status_code == 400 and "start creating your account again" in resp.text.lower()
    log_result(
        15,
        "Verify with no pending doc -> 400",
        passed,
        f"Status: {resp.status_code}, Message: {resp.json().get('detail', '')}",
    )


# =============================================================================
# C) POST /api/auth/signup/resend
# =============================================================================


def test_c16_resend_within_cooldown():
    """Test 16: Resend immediately after start (within 60s) -> 429."""
    email = f"resendcool+{int(time.time())}@gmail.com"
    cleanup_emails.append(email)

    # Start signup
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Test",
                "email": email,
                "password": "TestPass123!",
            },
        )

    if resp.status_code == 200:
        # Try to resend immediately
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/resend",
                json={"email": email},
            )

        passed = resp.status_code == 429 and "wait" in resp.text.lower()
        log_result(
            16,
            "Resend within cooldown -> 429",
            passed,
            f"Status: {resp.status_code}, Message: {resp.json().get('detail', '')}",
        )
    else:
        log_result(16, "Resend within cooldown -> 429", False, "Start failed")


def test_c17_resend_after_cooldown():
    """Test 17: Resend after cooldown -> 200 and code_hash changed."""
    email = f"resendok+{int(time.time())}@gmail.com"
    cleanup_emails.append(email)

    # Start signup
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Test",
                "email": email,
                "password": "TestPass123!",
            },
        )

    if resp.status_code == 200:
        # Get original code_hash
        pending = get_pending_signup(email)
        original_hash = pending.get("code_hash") if pending else None

        # Set last_sent_at to 2 minutes ago
        set_last_sent_at(email, 2)

        # Resend
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/resend",
                json={"email": email},
            )

        # Check new code_hash
        pending = get_pending_signup(email)
        new_hash = pending.get("code_hash") if pending else None
        attempts_reset = pending.get("attempts") == 0 if pending else False

        passed = (
            resp.status_code == 200
            and resp.json().get("sent") is True
            and new_hash != original_hash
            and attempts_reset
        )
        log_result(
            17,
            "Resend after cooldown -> 200",
            passed,
            f"Status: {resp.status_code}, Hash changed: {new_hash != original_hash}, "
            f"Attempts reset: {attempts_reset}",
        )
    else:
        log_result(17, "Resend after cooldown -> 200", False, "Start failed")


def test_c18_resend_cap():
    """Test 18: Resend with resends=3 -> 429."""
    email = f"resendcap+{int(time.time())}@gmail.com"
    cleanup_emails.append(email)

    # Start signup
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/start",
            json={
                "full_name": "Test",
                "email": email,
                "password": "TestPass123!",
            },
        )

    if resp.status_code == 200:
        # Set resends to 3
        set_resends(email, 3)

        # Try to resend
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{BASE_URL}/auth/signup/resend",
                json={"email": email},
            )

        passed = resp.status_code == 429
        log_result(
            18,
            "Resend cap (resends=3) -> 429",
            passed,
            f"Status: {resp.status_code}, Message: {resp.json().get('detail', '')}",
        )
    else:
        log_result(18, "Resend cap (resends=3) -> 429", False, "Start failed")


def test_c19_resend_no_pending():
    """Test 19: Resend with no pending doc -> 400."""
    email = f"resendnone+{int(time.time())}@gmail.com"

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup/resend",
            json={"email": email},
        )

    passed = resp.status_code == 400
    log_result(
        19,
        "Resend with no pending doc -> 400",
        passed,
        f"Status: {resp.status_code}, Message: {resp.json().get('detail', '')}",
    )


# =============================================================================
# D) Legacy + regression
# =============================================================================


def test_d20_legacy_signup():
    """Test 20: POST /api/auth/signup (legacy) -> 410 Gone."""
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/signup",
            json={
                "full_name": "Test",
                "email": "test@example.com",
                "password": "TestPass123!",
            },
        )

    passed = resp.status_code == 410
    log_result(
        20,
        "Legacy signup -> 410 Gone",
        passed,
        f"Status: {resp.status_code}, Message: {resp.json().get('detail', '')}",
    )


def test_d21_existing_account_login():
    """Test 21: Existing account can still log in."""
    # Test with testdoctor account
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/login",
            json={"email": "testdoctor@dermalens.com", "password": "TestPass123!"},
        )

    passed = resp.status_code == 200 and "access_token" in resp.json()
    log_result(
        21,
        "Existing account login -> 200",
        passed,
        f"Status: {resp.status_code}",
    )


def test_d22_other_endpoints():
    """Test 22: Other endpoints still work."""
    # Get token first
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            f"{BASE_URL}/auth/login",
            json={"email": "testdoctor@dermalens.com", "password": "TestPass123!"},
        )

    if resp.status_code != 200:
        log_result(22, "Other endpoints regression", False, "Login failed")
        return

    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    endpoints = [
        ("GET", "/auth/me", headers, 200),
        ("GET", "/auth/email-exists?email=testdoctor@dermalens.com", {}, 200),
        ("GET", "/billing/usage", headers, 200),
        ("GET", "/privacy-policy", {}, 200),
        ("GET", "/account-deletion", {}, 200),
        ("GET", "/activation-tool", {}, 200),
    ]

    all_passed = True
    details = []

    for method, path, hdrs, expected in endpoints:
        with httpx.Client(timeout=30) as client:
            if method == "GET":
                resp = client.get(f"{BASE_URL}{path}", headers=hdrs)
            else:
                resp = client.post(f"{BASE_URL}{path}", headers=hdrs)

        passed = resp.status_code == expected
        all_passed = all_passed and passed
        details.append(f"{method} {path}: {resp.status_code}")

    log_result(22, "Other endpoints regression", all_passed, "\n    ".join(details))


def test_d23_indexes():
    """Test 23: Confirm startup indexes exist."""
    client = get_mongo_client()
    db = client[DB_NAME]

    # Check pending_signups indexes
    pending_indexes = list(db.pending_signups.list_indexes())
    has_email_unique = any(
        idx.get("key", {}).get("email") and idx.get("unique") for idx in pending_indexes
    )
    has_created_ttl = any(
        idx.get("key", {}).get("created_at") and idx.get("expireAfterSeconds")
        for idx in pending_indexes
    )

    # Check signup_code_sends indexes
    sends_indexes = list(db.signup_code_sends.list_indexes())
    has_sends_ttl = any(
        idx.get("key", {}).get("created_at") and idx.get("expireAfterSeconds")
        for idx in sends_indexes
    )

    client.close()

    passed = has_email_unique and has_created_ttl and has_sends_ttl
    log_result(
        23,
        "Startup indexes exist",
        passed,
        f"pending_signups email unique: {has_email_unique}, "
        f"pending_signups TTL: {has_created_ttl}, "
        f"signup_code_sends TTL: {has_sends_ttl}",
    )


def test_d24_backend_logs():
    """Test 24: Check backend logs for 500s or tracebacks."""
    import subprocess

    try:
        result = subprocess.run(
            ["tail", "-n", "200", "/var/log/supervisor/backend.err.log"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        log_content = result.stdout

        # Look for recent 500s or tracebacks (ignore old ones)
        has_500 = "500" in log_content[-2000:]  # Last 2000 chars
        has_traceback = "Traceback" in log_content[-2000:]

        passed = not (has_500 or has_traceback)
        log_result(
            24,
            "Backend logs clean",
            passed,
            f"Recent 500s: {has_500}, Recent tracebacks: {has_traceback}",
        )
    except Exception as e:
        log_result(24, "Backend logs clean", False, f"Error reading logs: {e}")


# =============================================================================
# Main
# =============================================================================


def main():
    print("=" * 80)
    print("EMAIL-VERIFIED SIGN-UP FLOW TEST SUITE (v1.1.5)")
    print("=" * 80)

    # A) POST /api/auth/signup/start
    print("\n" + "=" * 80)
    print("A) POST /api/auth/signup/start")
    print("=" * 80)
    test_a1_valid_deliverable_address()
    test_a2_no_user_created()
    test_a3_malformed_emails()
    test_a4_disposable_domains()
    test_a5_reserved_names()
    test_a6_no_mail_server()
    test_a7_short_password()
    test_a8_existing_email()
    test_a9_rate_limit()

    # B) POST /api/auth/signup/verify
    print("\n" + "=" * 80)
    print("B) POST /api/auth/signup/verify")
    print("=" * 80)
    test_b10_wrong_code()
    test_b11_correct_code()
    test_b12_login_after_signup()
    test_b13_five_wrong_codes()
    test_b14_expired_code()
    test_b15_no_pending_doc()

    # C) POST /api/auth/signup/resend
    print("\n" + "=" * 80)
    print("C) POST /api/auth/signup/resend")
    print("=" * 80)
    test_c16_resend_within_cooldown()
    test_c17_resend_after_cooldown()
    test_c18_resend_cap()
    test_c19_resend_no_pending()

    # D) Legacy + regression
    print("\n" + "=" * 80)
    print("D) Legacy + regression")
    print("=" * 80)
    test_d20_legacy_signup()
    test_d21_existing_account_login()
    test_d22_other_endpoints()
    test_d23_indexes()
    test_d24_backend_logs()

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)

    passed = sum(1 for r in results if r["passed"])
    total = len(results)
    print(f"\nTotal: {passed}/{total} tests passed ({passed/total*100:.1f}%)")

    print("\n✅ PASSED:")
    for r in results:
        if r["passed"]:
            print(f"  {r['test']}: {r['description']}")

    failed = [r for r in results if not r["passed"]]
    if failed:
        print("\n❌ FAILED:")
        for r in failed:
            print(f"  {r['test']}: {r['description']}")
            if r["details"]:
                print(f"    {r['details']}")

    # Cleanup
    print("\n" + "=" * 80)
    print("CLEANUP")
    print("=" * 80)
    print(f"\nCleaning up {len(cleanup_emails)} test accounts...")
    for email in cleanup_emails:
        cleanup_user(email)
        cleanup_pending_signup(email)
        cleanup_signup_sends(email)
    print("Cleanup complete.")

    # Save results
    with open("/app/email_verified_signup_test_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("\nResults saved to: /app/email_verified_signup_test_results.json")


if __name__ == "__main__":
    main()
