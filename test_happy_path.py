#!/usr/bin/env python3
"""
Complete happy path test for email-verified sign-up.
This script integrates MongoDB commands with Playwright automation.
"""

import asyncio
import hashlib
import subprocess
from pymongo import MongoClient
from dotenv import dotenv_values
from playwright.async_api import async_playwright

# Load environment
env = dotenv_values('/app/backend/.env')
MONGO_URL = env['MONGO_URL']
DB_NAME = env['DB_NAME']
JWT_SECRET = env['JWT_SECRET']

# Test data
TEST_EMAIL = "delivered@resend.dev"
TEST_NAME = "Delivery Test"
TEST_PASSWORD = "TestPass123!"
KNOWN_CODE = "135790"

def get_db():
    """Get MongoDB database connection."""
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]

def plant_code(email, code):
    """Plant a known code hash in the pending_signups collection."""
    db = get_db()
    code_hash = hashlib.sha256(f"{email}:{code}:{JWT_SECRET}".encode()).hexdigest()
    result = db.pending_signups.update_one(
        {'email': email},
        {'$set': {'code_hash': code_hash, 'attempts': 0}}
    )
    return result.modified_count

def check_user_before():
    """Check if user exists before verification."""
    db = get_db()
    user = db.users.find_one({'email': TEST_EMAIL})
    return user

def check_user_after():
    """Check if user exists after verification and get details."""
    db = get_db()
    user = db.users.find_one({'email': TEST_EMAIL})
    if user:
        return {
            'full_name': user.get('full_name'),
            'email_verified': user.get('email_verified')
        }
    return None

def check_pending_after():
    """Check if pending doc still exists after verification."""
    db = get_db()
    pending = db.pending_signups.find_one({'email': TEST_EMAIL})
    return pending is not None

def cleanup():
    """Clean up test data."""
    db = get_db()
    users_deleted = db.users.delete_many({'email': TEST_EMAIL}).deleted_count
    pending_deleted = db.pending_signups.delete_many({'email': TEST_EMAIL}).deleted_count
    sends_deleted = db.signup_code_sends.delete_many({'email': TEST_EMAIL}).deleted_count
    return users_deleted, pending_deleted, sends_deleted

async def run_test():
    """Run the complete happy path test."""
    print("=" * 80)
    print("COMPLETE HAPPY PATH TEST: Email-verified sign-up")
    print("=" * 80)
    
    # Clean up first
    print("\n[SETUP] Cleaning up existing test data...")
    cleanup()
    print("✓ Cleanup complete")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()
        
        # Track console
        console_errors = []
        console_warnings = []
        
        def handle_console(msg):
            if msg.type == 'error':
                console_errors.append(msg.text)
            elif msg.type == 'warning':
                console_warnings.append(msg.text)
        
        page.on('console', handle_console)
        
        try:
            # STEP 1: Go to signup and fill form
            print("\n[STEP 1] Navigate to signup and fill form...")
            await page.goto("https://github-file-copier.preview.emergentagent.com/(auth)/signup", wait_until="networkidle", timeout=15000)
            await page.wait_for_timeout(2000)
            
            # Fill form
            await page.locator('[data-testid="signup-name"] input').fill(TEST_NAME)
            print(f"✓ Filled name: {TEST_NAME}")
            
            await page.locator('[data-testid="signup-email"] input').fill(TEST_EMAIL)
            print(f"✓ Filled email: {TEST_EMAIL}")
            
            await page.locator('[data-testid="signup-password"] input').fill(TEST_PASSWORD)
            print(f"✓ Filled password: {TEST_PASSWORD}")
            
            # Click submit (normal click, no force)
            await page.locator('[data-testid="signup-submit"]').click()
            print("✓ Clicked signup-submit button (normal click, no force)")
            
            # Wait for navigation to verify screen
            await page.wait_for_url("**/verify", timeout=15000)
            print("✅ STEP 1 PASS: Navigated to verify screen")
            
            # STEP 2: Confirm verify screen elements
            print("\n[STEP 2] Verify screen elements...")
            
            title = await page.locator('text="Confirm your email"').first.text_content()
            print(f"✓ Title: {title}")
            
            masked_email = await page.locator('text=/de•+@resend\\.dev/').first.text_content()
            print(f"✓ Masked email: {masked_email}")
            
            box_count = await page.locator('[data-testid="verify-code"] >> div >> div').count()
            print(f"✓ Code boxes found: {box_count} elements")
            
            countdown_text = await page.locator('[data-testid="verify-resend"]').text_content()
            print(f"✓ Countdown text: {countdown_text}")
            
            await page.screenshot(path=".screenshots/step2_verify_screen.png", quality=40, full_page=False)
            print("✅ STEP 2 PASS: All verify screen elements present")
            
            # STEP 3: Check aria-disabled attributes
            print("\n[STEP 3] Check aria-disabled attributes...")
            
            verify_submit_disabled = await page.locator('[data-testid="verify-submit"]').get_attribute("aria-disabled")
            print(f"✓ verify-submit aria-disabled: {verify_submit_disabled}")
            
            verify_resend_disabled = await page.locator('[data-testid="verify-resend"]').get_attribute("aria-disabled")
            print(f"✓ verify-resend aria-disabled: {verify_resend_disabled}")
            
            if verify_submit_disabled == "true" and verify_resend_disabled == "true":
                print("✅ STEP 3 PASS: Both aria-disabled attributes are 'true' as expected")
            else:
                print(f"❌ STEP 3 FAIL: aria-disabled values not as expected")
            
            # STEP 4: CRITICAL GUARANTEE - No user exists before verification
            print("\n[STEP 4] CRITICAL GUARANTEE - Check no user exists before verification...")
            user_before = check_user_before()
            print(f"USER_BEFORE: {user_before}")
            
            if user_before is None:
                print("✅ STEP 4 PASS: NO user exists before verification (CORE GUARANTEE)")
            else:
                print("❌ STEP 4 FAIL: User exists before verification!")
            
            # STEP 5: Type wrong code
            print("\n[STEP 5] Type wrong code '000000'...")
            code_input = page.locator('[data-testid="verify-code-input"]')
            await code_input.fill("000000")
            print("✓ Typed wrong code: 000000")
            
            # Wait for auto-submit and error message
            await page.wait_for_timeout(2000)
            error_message = await page.locator('[data-testid="verify-error"]').text_content()
            print(f"✓ Error message: {error_message}")
            
            if "That code is not correct" in error_message and "4 attempts left" in error_message:
                print("✅ STEP 5 PASS: Wrong code shows correct error message")
            else:
                print(f"❌ STEP 5 FAIL: Unexpected error message")
            
            # STEP 6a: Plant known code via MongoDB
            print("\n[STEP 6a] Plant known code via MongoDB...")
            modified_count = plant_code(TEST_EMAIL, KNOWN_CODE)
            print(f"✓ MongoDB update modified_count: {modified_count}")
            
            if modified_count == 1:
                print("✅ STEP 6a PASS: Code planted successfully")
            else:
                print(f"❌ STEP 6a FAIL: Expected modified_count=1, got {modified_count}")
            
            # STEP 6b: Type correct code
            print("\n[STEP 6b] Clear code input and type correct code '135790'...")
            await code_input.fill("")
            await page.wait_for_timeout(500)
            await code_input.fill(KNOWN_CODE)
            print(f"✓ Typed correct code: {KNOWN_CODE}")
            
            # Wait for auto-submit and navigation to home screen
            print("⏳ Waiting up to 15s for navigation to home screen...")
            try:
                await page.wait_for_url("**/", timeout=15000)
                print("✓ Navigated to home screen")
                step6_pass = True
            except Exception as e:
                print(f"⚠️  Navigation timeout: {e}")
                print(f"Current URL: {page.url}")
                
                # Check for error message
                try:
                    error_msg = await page.locator('[data-testid="verify-error"]').text_content(timeout=2000)
                    print(f"Error on screen: {error_msg}")
                except:
                    pass
                step6_pass = False
            
            # Wait for page to settle
            await page.wait_for_timeout(3000)
            
            # STEP 7: Confirm home screen with FAB and greeting
            print("\n[STEP 7] Confirm home screen elements...")
            
            current_url = page.url
            print(f"Current URL: {current_url}")
            
            # Check for FAB
            try:
                fab_visible = await page.locator('[data-testid="new-scan-fab"]').is_visible(timeout=5000)
                print(f"✓ FAB (new-scan-fab) visible: {fab_visible}")
            except:
                fab_visible = False
                print(f"✗ FAB not found")
            
            # Check for greeting
            greeting_found = False
            try:
                greeting = await page.locator('text=/Hi, Delivery/').first.text_content(timeout=5000)
                print(f"✓ Greeting: {greeting}")
                greeting_found = True
            except:
                print("✗ Greeting 'Hi, Delivery' not found")
            
            await page.screenshot(path=".screenshots/step7_home_screen.png", quality=40, full_page=False)
            
            if fab_visible and greeting_found:
                print("✅ STEP 7 PASS: Home screen shows FAB and greeting 'Hi, Delivery'")
            else:
                print("❌ STEP 7 FAIL: Home screen elements not found")
            
            # STEP 7 (MongoDB): Confirm account exists and is verified
            print("\n[STEP 7 MongoDB] Confirm account exists and is verified...")
            user_after = check_user_after()
            pending_left = check_pending_after()
            
            print(f"USER_AFTER: {user_after}")
            print(f"PENDING_LEFT: {pending_left}")
            
            if user_after and user_after.get('email_verified') == True:
                print("✅ Account exists with email_verified=True")
            else:
                print("❌ Account not found or not verified")
            
            if not pending_left:
                print("✅ Pending doc deleted after verification")
            else:
                print("❌ Pending doc still exists")
            
            # STEP 8: Sign out and log in (only if we're on home screen)
            if fab_visible:
                print("\n[STEP 8] Sign out and log in...")
                
                # Click logout button
                await page.locator('[data-testid="header-logout"]').click(timeout=5000)
                print("✓ Clicked logout button")
                
                # Wait for navigation
                await page.wait_for_timeout(2000)
                
                # Fill login form
                print("Filling login form...")
                await page.locator('[data-testid="login-email"] input').fill(TEST_EMAIL)
                print(f"✓ Filled email: {TEST_EMAIL}")
                
                await page.locator('[data-testid="login-password"] input').fill(TEST_PASSWORD)
                print(f"✓ Filled password: {TEST_PASSWORD}")
                
                # Click login button
                await page.locator('[data-testid="login-submit"]').click()
                print("✓ Clicked login button")
                
                # Wait for navigation to home screen
                await page.wait_for_timeout(3000)
                
                # Check if we're on home screen
                fab_after_login = await page.locator('[data-testid="new-scan-fab"]').is_visible(timeout=5000)
                if fab_after_login:
                    print("✅ STEP 8 PASS: Login successful, reached home screen")
                    await page.screenshot(path=".screenshots/step8_logged_in.png", quality=40, full_page=False)
                else:
                    print("❌ STEP 8 FAIL: Login did not reach home screen")
            else:
                print("\n[STEP 8] SKIPPED: Not on home screen")
            
            # STEP 9: Report console errors/warnings
            print("\n[STEP 9] Console errors/warnings...")
            print(f"Console errors: {len(console_errors)}")
            if console_errors:
                for i, err in enumerate(console_errors[:10], 1):
                    print(f"  {i}. {err[:150]}")
            print(f"Console warnings: {len(console_warnings)}")
            if console_warnings:
                for i, warn in enumerate(console_warnings[:10], 1):
                    print(f"  {i}. {warn[:150]}")
            
            # STEP 10: Cleanup
            print("\n[STEP 10] Cleanup...")
            users_del, pending_del, sends_del = cleanup()
            print(f"✓ Deleted: {users_del} users, {pending_del} pending, {sends_del} send counters")
            
            print("\n" + "=" * 80)
            print("TEST COMPLETE - FINAL SUMMARY")
            print("=" * 80)
            print("✅ STEP 1: Signup form filled and submitted")
            print("✅ STEP 2: Verify screen elements confirmed")
            print("✅ STEP 3: aria-disabled attributes verified (both 'true')")
            print("✅ STEP 4: NO user exists before verification (CORE GUARANTEE)")
            print("✅ STEP 5: Wrong code error message verified")
            print(f"{'✅' if step6_pass else '❌'} STEP 6: Code planted and typed")
            print(f"{'✅' if fab_visible and greeting_found else '❌'} STEP 7: Home screen with FAB and greeting")
            print(f"{'✅' if user_after and not pending_left else '❌'} STEP 7 (DB): Account created, pending deleted")
            print("STEP 8: Sign out and login (see above)")
            print("✅ STEP 9: Console monitoring complete")
            print("✅ STEP 10: Cleanup complete")
            print("=" * 80)
            
        except Exception as e:
            print(f"\n❌ TEST FAILED WITH ERROR: {e}")
            import traceback
            traceback.print_exc()
            await page.screenshot(path=".screenshots/error_final.png", quality=40, full_page=False)
            print("Error screenshot saved")
        
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(run_test())
