#!/usr/bin/env python3
"""
Focused test for POST /api/report/pdf after xhtml2pdf installation fix.
Also runs quick smoke tests to verify no regressions.
"""
import requests
import json
import sys

BASE_URL = "https://github-file-copier.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
TEST_EMAIL = "testdoctor@dermalens.com"
TEST_PASSWORD = "TestPass123!"

def print_result(test_name, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {test_name}")
    if details:
        print(f"   {details}")
    print()

def get_auth_token():
    """Login and get Bearer token. Create account if needed."""
    # Try login first
    resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=10
    )
    
    if resp.status_code == 200:
        return resp.json()["access_token"]
    
    # If login fails, try signup
    if resp.status_code == 401:
        signup_resp = requests.post(
            f"{BASE_URL}/auth/signup",
            json={
                "full_name": "Test Doctor",
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            },
            timeout=10
        )
        if signup_resp.status_code == 201:
            return signup_resp.json()["access_token"]
        elif signup_resp.status_code == 409:
            # Account exists but password wrong - this shouldn't happen
            print(f"❌ Account exists but login failed. Status: {resp.status_code}")
            sys.exit(1)
    
    print(f"❌ Failed to get auth token. Login status: {resp.status_code}")
    sys.exit(1)

def test_pdf_generation():
    """PRIMARY TEST: POST /api/report/pdf with valid token and HTML payload."""
    print("=" * 80)
    print("PRIMARY TEST: POST /api/report/pdf")
    print("=" * 80)
    
    token = get_auth_token()
    
    # Test 1: Valid PDF generation
    print("\n1. Testing valid PDF generation with Bearer token...")
    html_payload = {
        "html": "<html><body><h1>DermaLens Report</h1><p>Test</p></body></html>",
        "filename": "test-report.pdf"
    }
    
    resp = requests.post(
        f"{BASE_URL}/report/pdf",
        json=html_payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15
    )
    
    passed = False
    details = f"Status: {resp.status_code}"
    
    if resp.status_code == 200:
        content_type = resp.headers.get("Content-Type", "")
        content_disp = resp.headers.get("Content-Disposition", "")
        body_start = resp.content[:10] if len(resp.content) >= 10 else resp.content
        body_size = len(resp.content)
        
        details += f"\n   Content-Type: {content_type}"
        details += f"\n   Content-Disposition: {content_disp}"
        details += f"\n   Body size: {body_size} bytes"
        details += f"\n   Body starts with: {body_start}"
        
        # Check all requirements
        has_pdf_content_type = "application/pdf" in content_type
        has_attachment = "attachment" in content_disp
        has_pdf_magic = body_start.startswith(b"%PDF-")
        is_non_trivial = body_size > 100
        
        if has_pdf_content_type and has_attachment and has_pdf_magic and is_non_trivial:
            passed = True
            details += "\n   ✓ Content-Type is application/pdf"
            details += "\n   ✓ Content-Disposition has attachment"
            details += "\n   ✓ Body starts with %PDF- magic bytes"
            details += f"\n   ✓ Body size is non-trivial ({body_size} bytes)"
        else:
            if not has_pdf_content_type:
                details += "\n   ✗ Content-Type is NOT application/pdf"
            if not has_attachment:
                details += "\n   ✗ Content-Disposition missing 'attachment'"
            if not has_pdf_magic:
                details += "\n   ✗ Body does NOT start with %PDF- magic bytes"
            if not is_non_trivial:
                details += f"\n   ✗ Body size too small ({body_size} bytes)"
    else:
        details += f"\n   Response: {resp.text[:200]}"
    
    print_result("POST /api/report/pdf with valid token and HTML", passed, details)
    
    # Test 2: Without token (should return 401)
    print("2. Testing without Bearer token (should return 401)...")
    resp_no_auth = requests.post(
        f"{BASE_URL}/report/pdf",
        json=html_payload,
        timeout=10
    )
    
    passed_no_auth = resp_no_auth.status_code == 401
    details_no_auth = f"Status: {resp_no_auth.status_code}"
    if not passed_no_auth:
        details_no_auth += f"\n   Expected 401, got {resp_no_auth.status_code}"
        details_no_auth += f"\n   Response: {resp_no_auth.text[:200]}"
    
    print_result("POST /api/report/pdf without token returns 401", passed_no_auth, details_no_auth)
    
    # Test 3: Unsafe filename (should sanitize and succeed)
    print("3. Testing filename sanitization with unsafe characters...")
    unsafe_payload = {
        "html": "<html><body><h1>Test</h1></body></html>",
        "filename": "../../etc/pa ssw>d"
    }
    
    resp_unsafe = requests.post(
        f"{BASE_URL}/report/pdf",
        json=unsafe_payload,
        headers={"Authorization": f"Bearer {token}"},
        timeout=15
    )
    
    passed_unsafe = resp_unsafe.status_code == 200
    details_unsafe = f"Status: {resp_unsafe.status_code}"
    
    if passed_unsafe:
        content_disp = resp_unsafe.headers.get("Content-Disposition", "")
        details_unsafe += f"\n   Content-Disposition: {content_disp}"
        details_unsafe += "\n   ✓ Request succeeded despite unsafe filename"
        
        # Check if filename was sanitized in Content-Disposition
        if "../../" not in content_disp and ">" not in content_disp:
            details_unsafe += "\n   ✓ Filename appears to be sanitized"
        else:
            details_unsafe += "\n   ⚠ Filename may not be fully sanitized"
    else:
        details_unsafe += f"\n   Response: {resp_unsafe.text[:200]}"
    
    print_result("POST /api/report/pdf with unsafe filename", passed_unsafe, details_unsafe)
    
    return passed and passed_no_auth and passed_unsafe

def test_smoke_checks():
    """Quick smoke tests to verify no regressions."""
    print("=" * 80)
    print("SMOKE TESTS (regression check)")
    print("=" * 80)
    print()
    
    token = get_auth_token()
    all_passed = True
    
    # 1. GET /api/
    print("1. Testing GET /api/...")
    resp = requests.get(f"{BASE_URL}/", timeout=10)
    passed = resp.status_code == 200
    details = f"Status: {resp.status_code}"
    if not passed:
        details += f"\n   Response: {resp.text[:200]}"
    print_result("GET /api/", passed, details)
    all_passed = all_passed and passed
    
    # 2. POST /api/auth/login
    print("2. Testing POST /api/auth/login...")
    resp = requests.post(
        f"{BASE_URL}/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        timeout=10
    )
    passed = resp.status_code == 200 and "access_token" in resp.json()
    details = f"Status: {resp.status_code}"
    if passed:
        details += "\n   ✓ Received access_token"
    else:
        details += f"\n   Response: {resp.text[:200]}"
    print_result("POST /api/auth/login", passed, details)
    all_passed = all_passed and passed
    
    # 3. GET /api/auth/me
    print("3. Testing GET /api/auth/me...")
    resp = requests.get(
        f"{BASE_URL}/auth/me",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10
    )
    passed = resp.status_code == 200
    details = f"Status: {resp.status_code}"
    if passed:
        user_data = resp.json()
        details += f"\n   User: {user_data.get('email', 'N/A')}"
    else:
        details += f"\n   Response: {resp.text[:200]}"
    print_result("GET /api/auth/me", passed, details)
    all_passed = all_passed and passed
    
    # 4. GET /api/billing/usage
    print("4. Testing GET /api/billing/usage...")
    resp = requests.get(
        f"{BASE_URL}/billing/usage",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10
    )
    passed = resp.status_code == 200
    details = f"Status: {resp.status_code}"
    if passed:
        usage_data = resp.json()
        details += f"\n   analyses_used: {usage_data.get('analyses_used', 'N/A')}"
        details += f"\n   free_analyses: {usage_data.get('free_analyses', 'N/A')}"
        # Verify they are integers
        if isinstance(usage_data.get('analyses_used'), int) and isinstance(usage_data.get('free_analyses'), int):
            details += "\n   ✓ Both fields are integers"
        else:
            details += "\n   ✗ Fields are not integers"
            passed = False
    else:
        details += f"\n   Response: {resp.text[:200]}"
    print_result("GET /api/billing/usage", passed, details)
    all_passed = all_passed and passed
    
    # 5. GET /api/privacy-policy
    print("5. Testing GET /api/privacy-policy...")
    resp = requests.get(f"{BASE_URL}/privacy-policy", timeout=10)
    passed = resp.status_code == 200 and "text/html" in resp.headers.get("Content-Type", "")
    details = f"Status: {resp.status_code}"
    if passed:
        details += f"\n   Content-Type: {resp.headers.get('Content-Type')}"
        details += f"\n   Body length: {len(resp.text)} chars"
    else:
        details += f"\n   Response: {resp.text[:200]}"
    print_result("GET /api/privacy-policy", passed, details)
    all_passed = all_passed and passed
    
    # 6. GET /api/account-deletion
    print("6. Testing GET /api/account-deletion...")
    resp = requests.get(f"{BASE_URL}/account-deletion", timeout=10)
    passed = resp.status_code == 200 and "text/html" in resp.headers.get("Content-Type", "")
    details = f"Status: {resp.status_code}"
    if passed:
        details += f"\n   Content-Type: {resp.headers.get('Content-Type')}"
        details += f"\n   Body length: {len(resp.text)} chars"
    else:
        details += f"\n   Response: {resp.text[:200]}"
    print_result("GET /api/account-deletion", passed, details)
    all_passed = all_passed and passed
    
    return all_passed

def main():
    print("\n" + "=" * 80)
    print("DermaLens Backend Test - PDF Generation Fix Verification")
    print("=" * 80)
    print(f"Backend URL: {BASE_URL}")
    print(f"Test user: {TEST_EMAIL}")
    print("=" * 80)
    print()
    
    try:
        # Primary test: PDF generation
        pdf_passed = test_pdf_generation()
        
        # Smoke tests
        smoke_passed = test_smoke_checks()
        
        # Summary
        print("=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        
        if pdf_passed:
            print("✅ PRIMARY: POST /api/report/pdf - ALL 3 TESTS PASSED")
            print("   - Valid PDF generation with token: PASS")
            print("   - 401 without token: PASS")
            print("   - Filename sanitization: PASS")
        else:
            print("❌ PRIMARY: POST /api/report/pdf - FAILED")
        
        print()
        
        if smoke_passed:
            print("✅ SMOKE TESTS: ALL 6 ENDPOINTS PASSED")
        else:
            print("❌ SMOKE TESTS: SOME FAILURES")
        
        print()
        
        if pdf_passed and smoke_passed:
            print("🎉 ALL TESTS PASSED - PDF generation fix verified!")
            sys.exit(0)
        else:
            print("⚠️  SOME TESTS FAILED - See details above")
            sys.exit(1)
            
    except Exception as e:
        print(f"\n❌ TEST EXECUTION ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
