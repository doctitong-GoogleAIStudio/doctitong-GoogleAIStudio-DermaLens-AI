#!/usr/bin/env python3
"""
DermaLens AI Backend Regression Test Suite
Tests all endpoints after v1.1.4 sync from GitHub commit 073af9c
"""
import os
import sys
import json
import hmac
import hashlib
import base64
import requests
from datetime import datetime
from pymongo import MongoClient

# Configuration
BASE_URL = "https://github-file-copier.preview.emergentagent.com/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
ACTIVATION_SECRET = "DERM-ACT-2026-x7Qp9Lm3Vt8Bz1Ns"

# Test credentials - using .com domain as .test TLD is rejected by Pydantic EmailStr
TEST_DOCTOR = {
    "full_name": "Test Doctor",
    "email": "testdoctor@dermalens.com",
    "password": "TestPass123!"
}

DELETE_ME = {
    "full_name": "Delete Me",
    "email": "deleteme@dermalens.com",
    "password": "TestPass123!"
}

# Test results storage
results = {
    "priority1_billing_usage": [],
    "priority2_auth": [],
    "priority3_device": [],
    "priority4_account_deletion": [],
    "priority5_misc": [],
    "priority6_analyze": [],
    "errors": []
}

def log_result(category, test_name, passed, details):
    """Log test result"""
    result = {
        "test": test_name,
        "passed": passed,
        "details": details
    }
    results[category].append(result)
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {test_name}")
    if not passed or (isinstance(details, dict) and details.get("note")):
        print(f"  Details: {details}")

def make_activation_key(device_id):
    """Generate activation key using HMAC-SHA256"""
    normalized = device_id.strip().upper()
    mac = hmac.new(
        ACTIVATION_SECRET.encode('utf-8'),
        normalized.encode('utf-8'),
        hashlib.sha256
    )
    hex_key = mac.hexdigest()[:16].upper()
    # Format as XXXX-XXXX-XXXX-XXXX
    return f"{hex_key[0:4]}-{hex_key[4:8]}-{hex_key[8:12]}-{hex_key[12:16]}"

def create_test_account(account_data):
    """Create or get existing test account"""
    try:
        # Try to sign up
        response = requests.post(
            f"{BASE_URL}/auth/signup",
            json=account_data,
            timeout=10
        )
        if response.status_code == 201:
            data = response.json()
            return data.get("access_token"), data.get("user")
        elif response.status_code == 409:
            # Account exists, login instead
            response = requests.post(
                f"{BASE_URL}/auth/login",
                json={
                    "email": account_data["email"],
                    "password": account_data["password"]
                },
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("access_token"), data.get("user")
        return None, None
    except Exception as e:
        print(f"Error creating test account: {e}")
        return None, None

def insert_analysis_log(user_id):
    """Insert a fake analysis_logs document for testing counter"""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        doc = {
            "user_id": user_id,
            "status": 200,
            "created_at": datetime.utcnow(),
            "test_marker": "backend_test_py"
        }
        result = db.analysis_logs.insert_one(doc)
        client.close()
        return str(result.inserted_id)
    except Exception as e:
        print(f"Error inserting analysis log: {e}")
        return None

def cleanup_test_analysis_logs():
    """Remove test analysis logs"""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        result = db.analysis_logs.delete_many({"test_marker": "backend_test_py"})
        client.close()
        return result.deleted_count
    except Exception as e:
        print(f"Error cleaning up: {e}")
        return 0

# ============================================================================
# PRIORITY 1: GET /api/billing/usage (NEW v1.1.4 endpoint)
# ============================================================================
def test_priority1_billing_usage():
    print("\n" + "="*80)
    print("PRIORITY 1: GET /api/billing/usage (NEW v1.1.4 endpoint)")
    print("="*80)
    
    # Test 1: 401 without Authorization header
    try:
        response = requests.get(f"{BASE_URL}/billing/usage", timeout=10)
        passed = response.status_code == 401
        log_result("priority1_billing_usage", 
                   "GET /api/billing/usage without auth returns 401",
                   passed,
                   {"status": response.status_code, "body": response.text[:200]})
    except Exception as e:
        log_result("priority1_billing_usage", 
                   "GET /api/billing/usage without auth returns 401",
                   False, str(e))
    
    # Create fresh test account for usage testing
    fresh_email = f"fresh_{datetime.utcnow().timestamp()}@dermalens.com"
    fresh_account = {
        "full_name": "Fresh User",
        "email": fresh_email,
        "password": "TestPass123!"
    }
    
    token, user = create_test_account(fresh_account)
    if not token:
        log_result("priority1_billing_usage",
                   "Create fresh account for usage testing",
                   False, "Failed to create fresh account")
        return
    
    user_id = user.get("id")
    
    # Test 2: 200 with valid Bearer token, fresh account should have 0 used, 1 free
    try:
        response = requests.get(
            f"{BASE_URL}/billing/usage",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )
        passed = response.status_code == 200
        data = response.json() if passed else {}
        
        # Check the exact values for fresh account
        analyses_used = data.get("analyses_used")
        free_analyses = data.get("free_analyses")
        
        values_correct = (analyses_used == 0 and free_analyses == 1)
        
        log_result("priority1_billing_usage",
                   "GET /api/billing/usage with token returns 200 with correct initial values",
                   passed and values_correct,
                   {
                       "status": response.status_code,
                       "analyses_used": analyses_used,
                       "free_analyses": free_analyses,
                       "expected": "analyses_used=0, free_analyses=1",
                       "full_response": data
                   })
    except Exception as e:
        log_result("priority1_billing_usage",
                   "GET /api/billing/usage with token returns 200 with correct initial values",
                   False, str(e))
    
    # Test 3: Insert fake analysis_logs doc and verify counter increments
    if user_id:
        inserted_id = insert_analysis_log(user_id)
        if inserted_id:
            try:
                response = requests.get(
                    f"{BASE_URL}/billing/usage",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10
                )
                data = response.json() if response.status_code == 200 else {}
                analyses_used = data.get("analyses_used")
                
                passed = analyses_used == 1
                log_result("priority1_billing_usage",
                           "Counter increments after inserting analysis_logs doc",
                           passed,
                           {
                               "analyses_used": analyses_used,
                               "expected": 1,
                               "inserted_doc_id": inserted_id
                           })
            except Exception as e:
                log_result("priority1_billing_usage",
                           "Counter increments after inserting analysis_logs doc",
                           False, str(e))
        else:
            log_result("priority1_billing_usage",
                       "Counter increments after inserting analysis_logs doc",
                       False, "Failed to insert test analysis log")
    
    # Cleanup
    cleanup_test_analysis_logs()

# ============================================================================
# PRIORITY 2: Auth regression
# ============================================================================
def test_priority2_auth():
    print("\n" + "="*80)
    print("PRIORITY 2: Auth regression")
    print("="*80)
    
    # Test 1: POST /api/auth/signup - 201 success
    unique_email = f"newuser_{datetime.utcnow().timestamp()}@dermalens.com"
    try:
        response = requests.post(
            f"{BASE_URL}/auth/signup",
            json={
                "full_name": "New User",
                "email": unique_email,
                "password": "TestPass123!"
            },
            timeout=10
        )
        passed = response.status_code == 201
        data = response.json() if passed else {}
        has_token = "access_token" in data
        has_user = "user" in data
        
        log_result("priority2_auth",
                   "POST /api/auth/signup returns 201 with token and user",
                   passed and has_token and has_user,
                   {"status": response.status_code, "has_token": has_token, "has_user": has_user})
    except Exception as e:
        log_result("priority2_auth",
                   "POST /api/auth/signup returns 201 with token and user",
                   False, str(e))
    
    # Test 2: POST /api/auth/signup - 409 duplicate email
    try:
        response = requests.post(
            f"{BASE_URL}/auth/signup",
            json={
                "full_name": "Duplicate",
                "email": unique_email,
                "password": "TestPass123!"
            },
            timeout=10
        )
        passed = response.status_code == 409
        log_result("priority2_auth",
                   "POST /api/auth/signup returns 409 for duplicate email",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority2_auth",
                   "POST /api/auth/signup returns 409 for duplicate email",
                   False, str(e))
    
    # Test 3: POST /api/auth/signup - 422 invalid email
    try:
        response = requests.post(
            f"{BASE_URL}/auth/signup",
            json={
                "full_name": "Invalid Email",
                "email": "not-an-email",
                "password": "TestPass123!"
            },
            timeout=10
        )
        passed = response.status_code == 422
        log_result("priority2_auth",
                   "POST /api/auth/signup returns 422 for invalid email",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority2_auth",
                   "POST /api/auth/signup returns 422 for invalid email",
                   False, str(e))
    
    # Test 4: POST /api/auth/signup - 422 short password
    try:
        response = requests.post(
            f"{BASE_URL}/auth/signup",
            json={
                "full_name": "Short Pass",
                "email": f"short_{datetime.utcnow().timestamp()}@dermalens.com",
                "password": "12345"
            },
            timeout=10
        )
        passed = response.status_code == 422
        log_result("priority2_auth",
                   "POST /api/auth/signup returns 422 for password < 6 chars",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority2_auth",
                   "POST /api/auth/signup returns 422 for password < 6 chars",
                   False, str(e))
    
    # Create test account for login tests
    token, user = create_test_account(TEST_DOCTOR)
    
    # Test 5: POST /api/auth/login - 200 correct credentials
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={
                "email": TEST_DOCTOR["email"],
                "password": TEST_DOCTOR["password"]
            },
            timeout=10
        )
        passed = response.status_code == 200
        data = response.json() if passed else {}
        has_token = "access_token" in data
        
        log_result("priority2_auth",
                   "POST /api/auth/login returns 200 with correct credentials",
                   passed and has_token,
                   {"status": response.status_code, "has_token": has_token})
    except Exception as e:
        log_result("priority2_auth",
                   "POST /api/auth/login returns 200 with correct credentials",
                   False, str(e))
    
    # Test 6: POST /api/auth/login - 401 wrong password
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={
                "email": TEST_DOCTOR["email"],
                "password": "WrongPassword123!"
            },
            timeout=10
        )
        passed = response.status_code == 401
        log_result("priority2_auth",
                   "POST /api/auth/login returns 401 with wrong password",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority2_auth",
                   "POST /api/auth/login returns 401 with wrong password",
                   False, str(e))
    
    # Test 7: POST /api/auth/login - 401 unknown email
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={
                "email": "unknown@dermalens.com",
                "password": "TestPass123!"
            },
            timeout=10
        )
        passed = response.status_code == 401
        log_result("priority2_auth",
                   "POST /api/auth/login returns 401 for unknown email",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority2_auth",
                   "POST /api/auth/login returns 401 for unknown email",
                   False, str(e))
    
    # Test 8: GET /api/auth/me - 200 with token
    if token:
        try:
            response = requests.get(
                f"{BASE_URL}/auth/me",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10
            )
            passed = response.status_code == 200
            log_result("priority2_auth",
                       "GET /api/auth/me returns 200 with valid token",
                       passed,
                       {"status": response.status_code})
        except Exception as e:
            log_result("priority2_auth",
                       "GET /api/auth/me returns 200 with valid token",
                       False, str(e))
    
    # Test 9: GET /api/auth/me - 401 without token
    try:
        response = requests.get(f"{BASE_URL}/auth/me", timeout=10)
        passed = response.status_code == 401
        log_result("priority2_auth",
                   "GET /api/auth/me returns 401 without token",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority2_auth",
                   "GET /api/auth/me returns 401 without token",
                   False, str(e))
    
    # Test 10: GET /api/auth/me - 401 with garbage token
    try:
        response = requests.get(
            f"{BASE_URL}/auth/me",
            headers={"Authorization": "Bearer garbage_token_12345"},
            timeout=10
        )
        passed = response.status_code == 401
        log_result("priority2_auth",
                   "GET /api/auth/me returns 401 with garbage token",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority2_auth",
                   "GET /api/auth/me returns 401 with garbage token",
                   False, str(e))
    
    # Test 11: GET /api/auth/email-exists - true for existing
    try:
        response = requests.get(
            f"{BASE_URL}/auth/email-exists",
            params={"email": TEST_DOCTOR["email"]},
            timeout=10
        )
        passed = response.status_code == 200
        data = response.json() if passed else {}
        exists = data.get("exists", False)
        
        log_result("priority2_auth",
                   "GET /api/auth/email-exists returns true for existing account",
                   passed and exists,
                   {"status": response.status_code, "exists": exists})
    except Exception as e:
        log_result("priority2_auth",
                   "GET /api/auth/email-exists returns true for existing account",
                   False, str(e))
    
    # Test 12: GET /api/auth/email-exists - false for random
    try:
        response = requests.get(
            f"{BASE_URL}/auth/email-exists",
            params={"email": f"random_{datetime.utcnow().timestamp()}@dermalens.com"},
            timeout=10
        )
        passed = response.status_code == 200
        data = response.json() if passed else {}
        exists = data.get("exists", True)
        
        log_result("priority2_auth",
                   "GET /api/auth/email-exists returns false for random email",
                   passed and not exists,
                   {"status": response.status_code, "exists": exists})
    except Exception as e:
        log_result("priority2_auth",
                   "GET /api/auth/email-exists returns false for random email",
                   False, str(e))

# ============================================================================
# PRIORITY 3: Device activation
# ============================================================================
def test_priority3_device():
    print("\n" + "="*80)
    print("PRIORITY 3: Device activation")
    print("="*80)
    
    token, user = create_test_account(TEST_DOCTOR)
    
    # Test 1: POST /api/device/request-activation - 401 without token
    try:
        response = requests.post(
            f"{BASE_URL}/device/request-activation",
            json={"device_id": "TEST-DEVICE-001"},
            timeout=10
        )
        passed = response.status_code == 401
        log_result("priority3_device",
                   "POST /api/device/request-activation returns 401 without token",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority3_device",
                   "POST /api/device/request-activation returns 401 without token",
                   False, str(e))
    
    # Test 2: POST /api/device/request-activation - 200 with token
    if token:
        try:
            response = requests.post(
                f"{BASE_URL}/device/request-activation",
                headers={"Authorization": f"Bearer {token}"},
                json={"device_id": "TEST-DEVICE-001"},
                timeout=10
            )
            passed = response.status_code == 200
            data = response.json() if passed else {}
            
            log_result("priority3_device",
                       "POST /api/device/request-activation returns 200 with token",
                       passed,
                       {"status": response.status_code, "emailed": data.get("emailed"), 
                        "note": "emailed:false is acceptable"})
        except Exception as e:
            log_result("priority3_device",
                       "POST /api/device/request-activation returns 200 with token",
                       False, str(e))
    
    # Test 3: POST /api/device/activate - 400 wrong key (requires auth)
    if token:
        try:
            response = requests.post(
                f"{BASE_URL}/device/activate",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "device_id": "TEST-DEVICE-002",
                    "key": "WRONG-KEY-1234-5678"
                },
                timeout=10
            )
            passed = response.status_code == 400
            log_result("priority3_device",
                       "POST /api/device/activate returns 400 for wrong key",
                       passed,
                       {"status": response.status_code})
        except Exception as e:
            log_result("priority3_device",
                       "POST /api/device/activate returns 400 for wrong key",
                       False, str(e))
    
    # Test 4: POST /api/device/activate - 200 correct key (requires auth)
    test_device_id = "TEST-DEVICE-003"
    correct_key = make_activation_key(test_device_id)
    if token:
        try:
            response = requests.post(
                f"{BASE_URL}/device/activate",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "device_id": test_device_id,
                    "key": correct_key
                },
                timeout=10
            )
            passed = response.status_code == 200
            data = response.json() if passed else {}
            activated = data.get("activated", False)
            
            log_result("priority3_device",
                       "POST /api/device/activate returns 200 with correct key",
                       passed and activated,
                       {"status": response.status_code, "activated": activated, 
                        "key_used": correct_key})
        except Exception as e:
            log_result("priority3_device",
                       "POST /api/device/activate returns 200 with correct key",
                       False, str(e))
    
    # Test 5: GET /api/device/status - true for activated device (requires auth)
    if token:
        try:
            response = requests.get(
                f"{BASE_URL}/device/status",
                headers={"Authorization": f"Bearer {token}"},
                params={"device_id": test_device_id},
                timeout=10
            )
            passed = response.status_code == 200
            data = response.json() if passed else {}
            activated = data.get("activated", False)
            
            log_result("priority3_device",
                       "GET /api/device/status returns activated:true for activated device",
                       passed and activated,
                       {"status": response.status_code, "activated": activated})
        except Exception as e:
            log_result("priority3_device",
                       "GET /api/device/status returns activated:true for activated device",
                       False, str(e))
    
    # Test 6: GET /api/device/status - false for unknown device (requires auth)
    if token:
        try:
            response = requests.get(
                f"{BASE_URL}/device/status",
                headers={"Authorization": f"Bearer {token}"},
                params={"device_id": "UNKNOWN-DEVICE-999"},
                timeout=10
            )
            passed = response.status_code == 200
            data = response.json() if passed else {}
            activated = data.get("activated", True)
            
            log_result("priority3_device",
                       "GET /api/device/status returns activated:false for unknown device",
                       passed and not activated,
                       {"status": response.status_code, "activated": activated})
        except Exception as e:
            log_result("priority3_device",
                       "GET /api/device/status returns activated:false for unknown device",
                       False, str(e))

# ============================================================================
# PRIORITY 4: Account deletion + public pages
# ============================================================================
def test_priority4_account_deletion():
    print("\n" + "="*80)
    print("PRIORITY 4: Account deletion + public pages")
    print("="*80)
    
    # Test 1: GET /api/account-deletion - 200 HTML
    try:
        response = requests.get(f"{BASE_URL}/account-deletion", timeout=10)
        passed = response.status_code == 200
        is_html = "text/html" in response.headers.get("content-type", "")
        
        log_result("priority4_account_deletion",
                   "GET /api/account-deletion returns 200 HTML",
                   passed and is_html,
                   {"status": response.status_code, "content_type": response.headers.get("content-type")})
    except Exception as e:
        log_result("priority4_account_deletion",
                   "GET /api/account-deletion returns 200 HTML",
                   False, str(e))
    
    # Test 2: GET /api/privacy-policy - 200 HTML
    try:
        response = requests.get(f"{BASE_URL}/privacy-policy", timeout=10)
        passed = response.status_code == 200
        is_html = "text/html" in response.headers.get("content-type", "")
        
        log_result("priority4_account_deletion",
                   "GET /api/privacy-policy returns 200 HTML",
                   passed and is_html,
                   {"status": response.status_code, "content_type": response.headers.get("content-type")})
    except Exception as e:
        log_result("priority4_account_deletion",
                   "GET /api/privacy-policy returns 200 HTML",
                   False, str(e))
    
    # Create deleteme account
    delete_token, delete_user = create_test_account(DELETE_ME)
    
    # Test 3: POST /api/account/delete - 401 wrong password
    if delete_token:
        try:
            response = requests.post(
                f"{BASE_URL}/account/delete",
                headers={"Authorization": f"Bearer {delete_token}"},
                json={"password": "WrongPassword123!"},
                timeout=10
            )
            passed = response.status_code == 401
            log_result("priority4_account_deletion",
                       "POST /api/account/delete returns 401 with wrong password",
                       passed,
                       {"status": response.status_code})
        except Exception as e:
            log_result("priority4_account_deletion",
                       "POST /api/account/delete returns 401 with wrong password",
                       False, str(e))
        
        # Test 4: POST /api/account/delete - success with correct password
        try:
            response = requests.post(
                f"{BASE_URL}/account/delete",
                headers={"Authorization": f"Bearer {delete_token}"},
                json={"password": DELETE_ME["password"]},
                timeout=10
            )
            passed = response.status_code == 200
            log_result("priority4_account_deletion",
                       "POST /api/account/delete succeeds with correct password",
                       passed,
                       {"status": response.status_code})
        except Exception as e:
            log_result("priority4_account_deletion",
                       "POST /api/account/delete succeeds with correct password",
                       False, str(e))
        
        # Re-create deleteme account for credentials file validity
        create_test_account(DELETE_ME)
    
    # Test 5: POST /api/account-deletion - 404 unknown email
    try:
        response = requests.post(
            f"{BASE_URL}/account-deletion",
            json={
                "email": "unknown@dermalens.com",
                "password": "TestPass123!"
            },
            timeout=10
        )
        passed = response.status_code == 404
        log_result("priority4_account_deletion",
                   "POST /api/account-deletion returns 404 for unknown email",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority4_account_deletion",
                   "POST /api/account-deletion returns 404 for unknown email",
                   False, str(e))
    
    # Test 6: POST /api/account-deletion - 401 wrong password
    try:
        response = requests.post(
            f"{BASE_URL}/account-deletion",
            json={
                "email": TEST_DOCTOR["email"],
                "password": "WrongPassword123!"
            },
            timeout=10
        )
        passed = response.status_code == 401
        log_result("priority4_account_deletion",
                   "POST /api/account-deletion returns 401 for wrong password",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority4_account_deletion",
                   "POST /api/account-deletion returns 401 for wrong password",
                   False, str(e))
    
    # Test 7: POST /api/account-deletion/request - 202 for any email
    try:
        response = requests.post(
            f"{BASE_URL}/account-deletion/request",
            json={"email": "any@dermalens.com"},
            timeout=10
        )
        passed = response.status_code == 202
        log_result("priority4_account_deletion",
                   "POST /api/account-deletion/request returns 202",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority4_account_deletion",
                   "POST /api/account-deletion/request returns 202",
                   False, str(e))

# ============================================================================
# PRIORITY 5: Misc regression
# ============================================================================
def test_priority5_misc():
    print("\n" + "="*80)
    print("PRIORITY 5: Misc regression")
    print("="*80)
    
    # Test 1: GET /api/ - root message
    try:
        response = requests.get(f"{BASE_URL}/", timeout=10)
        passed = response.status_code == 200
        data = response.json() if passed else {}
        has_message = "message" in data
        
        log_result("priority5_misc",
                   'GET /api/ returns {"message": "DermaLens AI API"}',
                   passed and has_message,
                   {"status": response.status_code, "data": data})
    except Exception as e:
        log_result("priority5_misc",
                   'GET /api/ returns {"message": "DermaLens AI API"}',
                   False, str(e))
    
    # Test 2: GET /api/activation-tool - 200 HTML
    try:
        response = requests.get(f"{BASE_URL}/activation-tool", timeout=10)
        passed = response.status_code == 200
        is_html = "text/html" in response.headers.get("content-type", "")
        
        log_result("priority5_misc",
                   "GET /api/activation-tool returns 200 HTML",
                   passed and is_html,
                   {"status": response.status_code, "content_type": response.headers.get("content-type")})
    except Exception as e:
        log_result("priority5_misc",
                   "GET /api/activation-tool returns 200 HTML",
                   False, str(e))
    
    # Test 3: POST /api/report/pdf - 200 PDF
    token, user = create_test_account(TEST_DOCTOR)
    if token:
        try:
            response = requests.post(
                f"{BASE_URL}/report/pdf",
                headers={"Authorization": f"Bearer {token}"},
                json={"html": "<html><body><h1>Test Report</h1></body></html>"},
                timeout=10
            )
            passed = response.status_code == 200
            is_pdf = "application/pdf" in response.headers.get("content-type", "")
            
            log_result("priority5_misc",
                       "POST /api/report/pdf returns 200 with content-type application/pdf",
                       passed and is_pdf,
                       {"status": response.status_code, "content_type": response.headers.get("content-type")})
        except Exception as e:
            log_result("priority5_misc",
                       "POST /api/report/pdf returns 200 with content-type application/pdf",
                       False, str(e))
    
    # Test 4: POST /api/billing/subscription - configured: false
    if token:
        try:
            response = requests.post(
                f"{BASE_URL}/billing/subscription",
                headers={"Authorization": f"Bearer {token}"},
                json={"purchaseToken": "test_token_1234567890", "productId": "test_product"},
                timeout=10
            )
            passed = response.status_code == 200
            data = response.json() if passed else {}
            configured = data.get("configured")
            
            log_result("priority5_misc",
                       'POST /api/billing/subscription returns {"configured": false}',
                       passed and configured == False,
                       {"status": response.status_code, "data": data})
        except Exception as e:
            log_result("priority5_misc",
                       'POST /api/billing/subscription returns {"configured": false}',
                       False, str(e))

# ============================================================================
# PRIORITY 6: POST /api/analyze (minimal testing - REAL Gemini API)
# ============================================================================
def test_priority6_analyze():
    print("\n" + "="*80)
    print("PRIORITY 6: POST /api/analyze (minimal testing - REAL Gemini API)")
    print("="*80)
    
    # Test 1: 401 without Authorization and no X-Activation-Key
    try:
        response = requests.post(
            f"{BASE_URL}/analyze",
            json={"images": [{"data": "test", "mimeType": "image/png"}]},
            timeout=10
        )
        passed = response.status_code == 401
        log_result("priority6_analyze",
                   "POST /api/analyze returns 401 without auth",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority6_analyze",
                   "POST /api/analyze returns 401 without auth",
                   False, str(e))
    
    # Test 2: 403 with bogus X-Activation-Key
    try:
        response = requests.post(
            f"{BASE_URL}/analyze",
            headers={"X-Activation-Key": "BOGUS-KEY-1234-5678"},
            json={"images": [{"data": "test", "mimeType": "image/png"}]},
            timeout=10
        )
        passed = response.status_code == 403
        log_result("priority6_analyze",
                   "POST /api/analyze returns 403 with bogus activation key",
                   passed,
                   {"status": response.status_code})
    except Exception as e:
        log_result("priority6_analyze",
                   "POST /api/analyze returns 403 with bogus activation key",
                   False, str(e))
    
    token, user = create_test_account(TEST_DOCTOR)
    
    # Test 3: 422 for data with "data:" prefix
    if token:
        try:
            response = requests.post(
                f"{BASE_URL}/analyze",
                headers={"Authorization": f"Bearer {token}"},
                json={"images": [{"data": "data:image/png;base64,test", "mimeType": "image/png"}]},
                timeout=10
            )
            passed = response.status_code == 422
            log_result("priority6_analyze",
                       'POST /api/analyze returns 422 for data with "data:" prefix',
                       passed,
                       {"status": response.status_code})
        except Exception as e:
            log_result("priority6_analyze",
                       'POST /api/analyze returns 422 for data with "data:" prefix',
                       False, str(e))
    
    # Test 4: 422 for non-base64 garbage
    if token:
        try:
            response = requests.post(
                f"{BASE_URL}/analyze",
                headers={"Authorization": f"Bearer {token}"},
                json={"images": [{"data": "not-base64-!@#$%", "mimeType": "image/png"}]},
                timeout=10
            )
            passed = response.status_code == 422
            log_result("priority6_analyze",
                       "POST /api/analyze returns 422 for non-base64 garbage",
                       passed,
                       {"status": response.status_code})
        except Exception as e:
            log_result("priority6_analyze",
                       "POST /api/analyze returns 422 for non-base64 garbage",
                       False, str(e))
    
    # Test 5: 422 for unsupported mimeType (image/gif)
    if token:
        try:
            # Valid base64 but unsupported mime type
            response = requests.post(
                f"{BASE_URL}/analyze",
                headers={"Authorization": f"Bearer {token}"},
                json={"images": [{"data": "iVBORw0KGgo=", "mimeType": "image/gif"}]},
                timeout=10
            )
            passed = response.status_code == 422
            log_result("priority6_analyze",
                       "POST /api/analyze returns 422 for unsupported mimeType (image/gif)",
                       passed,
                       {"status": response.status_code})
        except Exception as e:
            log_result("priority6_analyze",
                       "POST /api/analyze returns 422 for unsupported mimeType (image/gif)",
                       False, str(e))
    
    # Test 6: 422 for empty images array
    if token:
        try:
            response = requests.post(
                f"{BASE_URL}/analyze",
                headers={"Authorization": f"Bearer {token}"},
                json={"images": []},
                timeout=10
            )
            passed = response.status_code == 422
            log_result("priority6_analyze",
                       "POST /api/analyze returns 422 for empty images array",
                       passed,
                       {"status": response.status_code})
        except Exception as e:
            log_result("priority6_analyze",
                       "POST /api/analyze returns 422 for empty images array",
                       False, str(e))
    
    # Test 7: 422 for more than 4 images
    if token:
        try:
            images = [{"data": "iVBORw0KGgo=", "mimeType": "image/png"} for _ in range(5)]
            response = requests.post(
                f"{BASE_URL}/analyze",
                headers={"Authorization": f"Bearer {token}"},
                json={"images": images},
                timeout=10
            )
            passed = response.status_code == 422
            log_result("priority6_analyze",
                       "POST /api/analyze returns 422 for more than 4 images",
                       passed,
                       {"status": response.status_code})
        except Exception as e:
            log_result("priority6_analyze",
                       "POST /api/analyze returns 422 for more than 4 images",
                       False, str(e))
    
    print("\n⚠️  Skipping successful analyze call to avoid burning Gemini API quota")

# ============================================================================
# Main execution
# ============================================================================
def main():
    print("="*80)
    print("DermaLens AI Backend Regression Test Suite")
    print("v1.1.4 - Commit 073af9c")
    print("="*80)
    
    try:
        test_priority1_billing_usage()
        test_priority2_auth()
        test_priority3_device()
        test_priority4_account_deletion()
        test_priority5_misc()
        test_priority6_analyze()
        
        # Print summary
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        
        total_tests = 0
        passed_tests = 0
        
        for category, tests in results.items():
            if category == "errors":
                continue
            category_passed = sum(1 for t in tests if t["passed"])
            category_total = len(tests)
            total_tests += category_total
            passed_tests += category_passed
            
            print(f"\n{category}: {category_passed}/{category_total} passed")
            for test in tests:
                if not test["passed"]:
                    print(f"  ❌ {test['test']}")
                    print(f"     {test['details']}")
        
        print(f"\n{'='*80}")
        print(f"OVERALL: {passed_tests}/{total_tests} tests passed")
        print(f"{'='*80}")
        
        # Save results to JSON
        with open("/app/backend_test_results.json", "w") as f:
            json.dump(results, f, indent=2)
        
        print(f"\nDetailed results saved to /app/backend_test_results.json")
        
        return 0 if passed_tests == total_tests else 1
        
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
