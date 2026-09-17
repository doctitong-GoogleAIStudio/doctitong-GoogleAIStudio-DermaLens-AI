#!/bin/bash

echo "================================================================================"
echo "HAPPY PATH TEST COORDINATOR"
echo "================================================================================"

# Clean up first
echo ""
echo "[SETUP] Cleaning up existing test data..."
python3 -c "from pymongo import MongoClient; from dotenv import dotenv_values; e=dotenv_values('/app/backend/.env'); db=MongoClient(e['MONGO_URL'])[e['DB_NAME']]; db.users.delete_many({'email':'delivered@resend.dev'}); db.pending_signups.delete_many({'email':'delivered@resend.dev'}); db.signup_code_sends.delete_many({'email':'delivered@resend.dev'}); print('✓ Cleanup complete')"

echo ""
echo "[STEP 4] Check no user exists before verification..."
python3 -c "from pymongo import MongoClient; from dotenv import dotenv_values; e=dotenv_values('/app/backend/.env'); db=MongoClient(e['MONGO_URL'])[e['DB_NAME']]; print('USER_BEFORE:', db.users.find_one({'email':'delivered@resend.dev'}))"

echo ""
echo "================================================================================"
echo "NOW RUN THE PLAYWRIGHT TEST"
echo "It will:"
echo "  1. Fill signup form and submit"
echo "  2. Land on verify screen"
echo "  3. Check aria-disabled attributes"
echo "  4. Type wrong code '000000'"
echo "  5. PAUSE for 15 seconds"
echo "================================================================================"
echo ""
echo "Press ENTER to continue..."
read

echo ""
echo "[STEP 6a] Planting known code '135790' in MongoDB..."
python3 -c "import hashlib; from pymongo import MongoClient; from dotenv import dotenv_values; e=dotenv_values('/app/backend/.env'); db=MongoClient(e['MONGO_URL'])[e['DB_NAME']]; E='delivered@resend.dev'; h=hashlib.sha256((E+':135790:'+e['JWT_SECRET']).encode()).hexdigest(); print('Modified count:', db.pending_signups.update_one({'email':E},{'\$set':{'code_hash':h,'attempts':0}}).modified_count)"

echo ""
echo "================================================================================"
echo "Code planted! The Playwright test will now:"
echo "  6. Type correct code '135790'"
echo "  7. Navigate to home screen"
echo "  8. Sign out and log in"
echo "================================================================================"
echo ""
echo "After the test completes, run this to check the results:"
echo ""
echo "[STEP 7 MongoDB] Check account exists and is verified..."
python3 -c "from pymongo import MongoClient; from dotenv import dotenv_values; e=dotenv_values('/app/backend/.env'); db=MongoClient(e['MONGO_URL'])[e['DB_NAME']]; u=db.users.find_one({'email':'delivered@resend.dev'}); print('USER_AFTER:', u and (u['full_name'], u.get('email_verified'))); print('PENDING_LEFT:', db.pending_signups.find_one({'email':'delivered@resend.dev'}) is not None)"

echo ""
echo "[STEP 10] Cleanup..."
python3 -c "from pymongo import MongoClient; from dotenv import dotenv_values; e=dotenv_values('/app/backend/.env'); db=MongoClient(e['MONGO_URL'])[e['DB_NAME']]; print('Deleted:', db.users.delete_many({'email':'delivered@resend.dev'}).deleted_count, 'users,', db.pending_signups.delete_many({}).deleted_count, 'pending,', db.signup_code_sends.delete_many({}).deleted_count, 'sends')"

echo ""
echo "================================================================================"
echo "TEST COMPLETE"
echo "================================================================================"
