#!/usr/bin/env bash
# Seeds two confirmed local Supabase auth users in one shared family, for
# the Maestro flows under .maestro/ to sign in as. Local stack only
# (127.0.0.1) — never point this at a real project. Idempotent: safe to
# run against a database that already has these users (each step no-ops
# or is ignored on conflict), but the intended usage is straight after
# `npm run db:reset`, which starts from a clean slate.
#
# Usage: npm run e2e:seed
set -uo pipefail

API_URL="http://127.0.0.1:54321"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

USER_A_EMAIL="maestro-user-a@familyflow.test"
USER_B_EMAIL="maestro-user-b@familyflow.test"
PASSWORD="Maestro1234"

admin_create_user() {
  local email="$1"
  curl -sS -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"email_confirm\":true}"
}

sign_in() {
  local email="$1"
  curl -sS -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PASSWORD\"}" | jq -r '.access_token'
}

rpc() {
  local token="$1" fn="$2" body="$3"
  curl -sS -X POST "$API_URL/rest/v1/rpc/$fn" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$body"
}

echo "Creating Maestro test users (idempotent — ignore 'already exists' from either)..."
admin_create_user "$USER_A_EMAIL" > /dev/null
admin_create_user "$USER_B_EMAIL" > /dev/null

TOKEN_A=$(sign_in "$USER_A_EMAIL")
TOKEN_B=$(sign_in "$USER_B_EMAIL")

if [ -z "$TOKEN_A" ] || [ "$TOKEN_A" = "null" ] || [ -z "$TOKEN_B" ] || [ "$TOKEN_B" = "null" ]; then
  echo "Failed to sign in one or both Maestro test users. Is the local Supabase stack running (npm run supabase:start)?" >&2
  exit 1
fi

echo "Creating a shared family owned by user A..."
FAMILY_RESP=$(rpc "$TOKEN_A" "create_family_with_owner" '{"p_name":"Maestro E2E Family"}')
FAMILY_ID=$(echo "$FAMILY_RESP" | jq -r '.[0].family_id')
USER_A_MEMBER_ID=$(echo "$FAMILY_RESP" | jq -r '.[0].family_member_id')

if [ -z "$FAMILY_ID" ] || [ "$FAMILY_ID" = "null" ]; then
  echo "Failed to create the Maestro E2E family — user A may already own one from a prior seed run without a db reset in between." >&2
  echo "Response: $FAMILY_RESP" >&2
  exit 1
fi

echo "Inviting and accepting user B into the family..."
INVITE_RESP=$(rpc "$TOKEN_A" "create_family_invitation" "{\"p_family_id\":\"$FAMILY_ID\",\"p_invited_email\":\"$USER_B_EMAIL\"}")
INVITE_TOKEN=$(echo "$INVITE_RESP" | jq -r '.[0].token')
ACCEPT_RESP=$(rpc "$TOKEN_B" "accept_family_invitation" "{\"p_token\":\"$INVITE_TOKEN\"}")
USER_B_MEMBER_ID=$(echo "$ACCEPT_RESP" | jq -r '.[0].family_member_id')

echo "Done. Maestro test fixtures:"
echo "  User A (owner): $USER_A_EMAIL / $PASSWORD (member $USER_A_MEMBER_ID)"
echo "  User B (adult): $USER_B_EMAIL / $PASSWORD (member $USER_B_MEMBER_ID)"
echo "  Family: Maestro E2E Family ($FAMILY_ID)"

# Machine-readable fixture file for Maestro flows that need to target a
# specific member deterministically (e.g. picking "User B" in the assignee
# picker, where both members' display names default to the same "Family
# member"/"Owner" text and so can't be told apart by text alone). Consumed
# via `maestro test -e USER_B_MEMBER_ID=... --env-file` is not supported by
# this Maestro version, so npm run e2e:ios sources this file directly and
# passes the values with `-e`. Not committed (see .gitignore) — regenerated
# by every seed run.
cat > .maestro/.env.local <<EOF
FAMILY_ID=$FAMILY_ID
USER_A_MEMBER_ID=$USER_A_MEMBER_ID
USER_B_MEMBER_ID=$USER_B_MEMBER_ID
EOF
