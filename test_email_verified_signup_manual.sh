#!/bin/bash
# Comprehensive manual test for email-verified sign-up flow (v1.1.5)

BASE_URL="https://github-file-copier.preview.emergentagent.com/api"
MONGO_URL="mongodb://localhost:27017"
DB_NAME="test_database"
JWT_SECRET="b09c6cb11ccbe4c3a48e383247020e3c7833ef3b7930b0d60626799652d69824"

echo "================================================================================"
echo "EMAIL-VERIFIED SIGN-UP FLOW MANUAL TEST (v1.1.5)"
echo "================================================================================"

# Helper function to generate code hash
code_hash() {
    local email=$1
    local code=$2
    echo -n "${email}:${code}:${JWT_SECRET}" | sha256sum | awk '{print $1}'
}

# A) POST /api/auth/signup/start
echo ""
echo "================================================================================"
echo "A) POST /api/auth/signup/start"
echo "================================================================================"

# Test 1: Valid deliverable address (using delivered@resend.dev)
echo ""
echo "Test 1: Valid deliverable address"
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval 'db.pending_signups.deleteOne({email: "delivered@resend.dev"})'
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval 'db.signup_code_sends.deleteMany({email: "delivered@resend.dev"})'
RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/auth/signup/start" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Test User","email":"delivered@resend.dev","password":"TestPass123!"}')
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
echo "Status: $STATUS"
echo "Body: $BODY"
if [ "$STATUS" = "200" ]; then
    echo "✅ PASS: Valid deliverable address"
    # Check pending doc
    mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval 'db.pending_signups.findOne({email: "delivered@resend.dev"}, {code_hash: 1, password_hash: 1, attempts: 1, expires_at: 1, _id: 0})'
else
    echo "❌ FAIL: Expected 200, got $STATUS"
fi

# Test 2: Confirm NO user row created
echo ""
echo "Test 2: No user row created before verification"
USER_COUNT=$(mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval 'db.users.countDocuments({email: "delivered@resend.dev"})')
if [ "$USER_COUNT" = "0" ]; then
    echo "✅ PASS: No user row created"
else
    echo "❌ FAIL: User row exists"
fi

# Test 3: Malformed emails
echo ""
echo "Test 3: Malformed emails -> 422"
for email in "plainaddress" "a@b" "jane@company" "a..b@gmail.com"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/auth/signup/start" \
      -H "Content-Type: application/json" \
      -d "{\"full_name\":\"Test\",\"email\":\"$email\",\"password\":\"TestPass123!\"}")
    echo "  $email: $STATUS"
done

# Test 4: Disposable domains
echo ""
echo "Test 4: Disposable domains -> 400"
for email in "test@mailinator.com" "test@yopmail.com" "test@foo.mailinator.com"; do
    RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/start" \
      -H "Content-Type: application/json" \
      -d "{\"full_name\":\"Test\",\"email\":\"$email\",\"password\":\"TestPass123!\"}")
    echo "  $email: $(echo $RESP | jq -r '.detail // empty')"
done

# Test 5: RFC-reserved names
echo ""
echo "Test 5: RFC-reserved names -> 400/422"
for email in "test@dermalens.test" "test@example.com"; do
    RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/start" \
      -H "Content-Type: application/json" \
      -d "{\"full_name\":\"Test\",\"email\":\"$email\",\"password\":\"TestPass123!\"}")
    echo "  $email: $(echo $RESP | jq -r '.detail // empty' | head -c 80)"
done

# Test 6: Domain with no mail server
echo ""
echo "Test 6: Domain with no mail server -> 400"
RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/start" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Test","email":"test@thisdomaindoesnotexist-zzz12345.com","password":"TestPass123!"}')
echo "  Message: $(echo $RESP | jq -r '.detail')"

# Test 7: Short password
echo ""
echo "Test 7: Password < 8 chars -> 422"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/auth/signup/start" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Test","email":"test@gmail.com","password":"short"}')
echo "  Status: $STATUS"

# Test 8: Existing email
echo ""
echo "Test 8: Existing email -> 409"
RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/start" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Test","email":"testdoctor@dermalens.com","password":"TestPass123!"}')
echo "  Message: $(echo $RESP | jq -r '.detail')"

# Test 9: Rate limit (skip - would require 6 sends)
echo ""
echo "Test 9: Rate limit - SKIPPED (would require 6 sends to delivered@resend.dev)"

# B) POST /api/auth/signup/verify
echo ""
echo "================================================================================"
echo "B) POST /api/auth/signup/verify"
echo "================================================================================"

# Test 10: Wrong code
echo ""
echo "Test 10: Wrong code -> 400 with attempts"
# Use the pending doc from test 1
RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/verify" \
  -H "Content-Type: application/json" \
  -d '{"email":"delivered@resend.dev","code":"999999"}')
echo "  Message: $(echo $RESP | jq -r '.detail')"

# Test 11: Correct code (via hash trick)
echo ""
echo "Test 11: Correct code -> 201 with token"
TEST_EMAIL="correctcode$(date +%s)@test.local"
# Create a pending doc manually
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "
db.pending_signups.insertOne({
  email: '${TEST_EMAIL}',
  full_name: 'Correct Test',
  password_hash: '\$2b\$12\$abcdefghijklmnopqrstuvwxyz1234567890',
  code_hash: '$(code_hash "${TEST_EMAIL}" "123456")',
  attempts: 0,
  resends: 0,
  last_sent_at: new Date(),
  expires_at: new Date(Date.now() + 600000),
  created_at: new Date()
})
"
# Verify with known code
RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/auth/signup/verify" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}\",\"code\":\"123456\"}")
STATUS=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
echo "  Status: $STATUS"
if [ "$STATUS" = "201" ]; then
    echo "  ✅ Has access_token: $(echo $BODY | jq -r 'has("access_token")')"
    echo "  ✅ Has user: $(echo $BODY | jq -r 'has("user")')"
    # Check user doc
    USER=$(mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "db.users.findOne({email: '${TEST_EMAIL}'}, {email_verified: 1, _id: 0})")
    echo "  User email_verified: $USER"
    # Check pending doc deleted
    PENDING_COUNT=$(mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "db.pending_signups.countDocuments({email: '${TEST_EMAIL}'})")
    echo "  Pending doc deleted: $([ "$PENDING_COUNT" = "0" ] && echo "true" || echo "false")"
fi

# Test 12: Login after signup
echo ""
echo "Test 12: New account can log in"
# This test would fail because we used a fake password hash above
echo "  SKIPPED (test account has fake password hash)"

# Test 13: Five wrong codes
echo ""
echo "Test 13: Five wrong codes -> 429 and doc deleted"
TEST_EMAIL="fivewrong$(date +%s)@test.local"
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "
db.pending_signups.insertOne({
  email: '${TEST_EMAIL}',
  full_name: 'Test',
  password_hash: '\$2b\$12\$abcdefghijklmnopqrstuvwxyz1234567890',
  code_hash: '$(code_hash "${TEST_EMAIL}" "123456")',
  attempts: 0,
  resends: 0,
  last_sent_at: new Date(),
  expires_at: new Date(Date.now() + 600000),
  created_at: new Date()
})
"
for i in {1..5}; do
    RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/auth/signup/verify" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"${TEST_EMAIL}\",\"code\":\"99999${i}\"}")
    STATUS=$(echo "$RESP" | tail -1)
    echo "  Attempt $i: $STATUS"
done
PENDING_COUNT=$(mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "db.pending_signups.countDocuments({email: '${TEST_EMAIL}'})")
echo "  Pending doc deleted: $([ "$PENDING_COUNT" = "0" ] && echo "true" || echo "false")"

# Test 14: Expired code
echo ""
echo "Test 14: Expired code -> 400 and doc removed"
TEST_EMAIL="expired$(date +%s)@test.local"
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "
db.pending_signups.insertOne({
  email: '${TEST_EMAIL}',
  full_name: 'Test',
  password_hash: '\$2b\$12\$abcdefghijklmnopqrstuvwxyz1234567890',
  code_hash: '$(code_hash "${TEST_EMAIL}" "123456")',
  attempts: 0,
  resends: 0,
  last_sent_at: new Date(),
  expires_at: new Date(Date.now() - 60000),
  created_at: new Date()
})
"
RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/verify" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}\",\"code\":\"123456\"}")
echo "  Message: $(echo $RESP | jq -r '.detail')"
PENDING_COUNT=$(mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "db.pending_signups.countDocuments({email: '${TEST_EMAIL}'})")
echo "  Pending doc deleted: $([ "$PENDING_COUNT" = "0" ] && echo "true" || echo "false")"

# Test 15: No pending doc
echo ""
echo "Test 15: Verify with no pending doc -> 400"
RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/verify" \
  -H "Content-Type: application/json" \
  -d '{"email":"nopending@test.local","code":"123456"}')
echo "  Message: $(echo $RESP | jq -r '.detail')"

# C) POST /api/auth/signup/resend
echo ""
echo "================================================================================"
echo "C) POST /api/auth/signup/resend"
echo "================================================================================"

# Test 16: Resend within cooldown
echo ""
echo "Test 16: Resend within cooldown -> 429"
# Use the delivered@resend.dev pending doc
RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/resend" \
  -H "Content-Type: application/json" \
  -d '{"email":"delivered@resend.dev"}')
echo "  Message: $(echo $RESP | jq -r '.detail')"

# Test 17: Resend after cooldown
echo ""
echo "Test 17: Resend after cooldown -> 200"
# Set last_sent_at to 2 minutes ago
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "
db.pending_signups.updateOne(
  {email: 'delivered@resend.dev'},
  {\$set: {last_sent_at: new Date(Date.now() - 120000)}}
)
"
# Get original code_hash
ORIGINAL_HASH=$(mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "db.pending_signups.findOne({email: 'delivered@resend.dev'}, {code_hash: 1, _id: 0}).code_hash")
RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/auth/signup/resend" \
  -H "Content-Type: application/json" \
  -d '{"email":"delivered@resend.dev"}')
STATUS=$(echo "$RESP" | tail -1)
echo "  Status: $STATUS"
# Check new code_hash
NEW_HASH=$(mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "db.pending_signups.findOne({email: 'delivered@resend.dev'}, {code_hash: 1, _id: 0}).code_hash")
echo "  Code hash changed: $([ "$ORIGINAL_HASH" != "$NEW_HASH" ] && echo "true" || echo "false")"

# Test 18: Resend cap
echo ""
echo "Test 18: Resend cap (resends=3) -> 429"
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval "
db.pending_signups.updateOne(
  {email: 'delivered@resend.dev'},
  {\$set: {resends: 3}}
)
"
RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/resend" \
  -H "Content-Type: application/json" \
  -d '{"email":"delivered@resend.dev"}')
echo "  Message: $(echo $RESP | jq -r '.detail')"

# Test 19: Resend with no pending doc
echo ""
echo "Test 19: Resend with no pending doc -> 400"
RESP=$(curl -s -X POST "${BASE_URL}/auth/signup/resend" \
  -H "Content-Type: application/json" \
  -d '{"email":"nopending@test.local"}')
echo "  Message: $(echo $RESP | jq -r '.detail')"

# D) Legacy + regression
echo ""
echo "================================================================================"
echo "D) Legacy + regression"
echo "================================================================================"

# Test 20: Legacy signup
echo ""
echo "Test 20: Legacy signup -> 410 Gone"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"full_name":"Test","email":"test@example.com","password":"TestPass123!"}')
echo "  Status: $STATUS"

# Test 21: Existing account login
echo ""
echo "Test 21: Existing account login -> 200"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"testdoctor@dermalens.com","password":"TestPass123!"}')
echo "  Status: $STATUS"

# Test 22: Other endpoints
echo ""
echo "Test 22: Other endpoints regression"
# Get token first
TOKEN=$(curl -s -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"testdoctor@dermalens.com","password":"TestPass123!"}' | jq -r '.access_token')
echo "  GET /auth/me: $(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "${BASE_URL}/auth/me")"
echo "  GET /auth/email-exists: $(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/auth/email-exists?email=testdoctor@dermalens.com")"
echo "  GET /billing/usage: $(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "${BASE_URL}/billing/usage")"
echo "  GET /privacy-policy: $(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/privacy-policy")"
echo "  GET /account-deletion: $(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/account-deletion")"
echo "  GET /activation-tool: $(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/activation-tool")"

# Test 23: Indexes
echo ""
echo "Test 23: Startup indexes"
echo "  pending_signups indexes:"
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval 'db.pending_signups.getIndexes()' | grep -E '(email|created_at|unique|expireAfterSeconds)'
echo "  signup_code_sends indexes:"
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval 'db.signup_code_sends.getIndexes()' | grep -E '(created_at|expireAfterSeconds)'

# Test 24: Backend logs
echo ""
echo "Test 24: Backend logs"
echo "  Recent errors:"
tail -n 50 /var/log/supervisor/backend.err.log | grep -E "(500|Traceback)" | tail -5

# Cleanup
echo ""
echo "================================================================================"
echo "CLEANUP"
echo "================================================================================"
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval 'db.pending_signups.deleteOne({email: "delivered@resend.dev"})'
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval 'db.signup_code_sends.deleteMany({email: "delivered@resend.dev"})'
mongosh "${MONGO_URL}/${DB_NAME}" --quiet --eval 'db.users.deleteMany({email: {$regex: "@test.local$"}})'
echo "Cleanup complete."
