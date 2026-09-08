#!/usr/bin/env bash
# Real multi-user backend integration flow for shared-family-task
# assignment push notifications (Phase 6). Exercises the actual
# RPC/RLS/trigger surface against a live local Postgres instance with
# real auth.users accounts, then runs the real dispatch-notifications
# Edge Function code (supabase/functions/dispatch-notifications/index.ts)
# against a FAKE Expo transport (supabase/functions/dispatch-notifications
# /cli.ts) — never a real push send. Complements, does not replace,
# `npm run db:test` (pgTAP) or the dispatcher's own Deno test suite.
#
# LOCAL SUPABASE ONLY. Every URL/connection string this script uses is
# read from `supabase status` and verified to resolve to
# 127.0.0.1/localhost before a single request is sent or a single
# connection is opened - this script refuses to run against anything
# else, including a real/staging/production project. Mirrors
# scripts/e2e-backend.sh's own safety gate and cleanup discipline.
#
# Usage: npm run e2e:notifications
# Prerequisites: the local Supabase stack running (npm run supabase:start)
# and Deno installed (the dispatcher itself, in supabase/functions, is a
# Deno module). Every identity/row this script creates is unique per run
# and cleaned up on exit (see `cleanup` below), so a repeat run is safe.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_TS="$REPO_ROOT/supabase/functions/dispatch-notifications/cli.ts"

if ! command -v deno >/dev/null 2>&1; then
  echo "deno is not installed - required to run the real dispatch-notifications code (Deno Edge Function)." >&2
  exit 1
fi

STACK_STATUS_ERR=$(mktemp)
if ! STACK_STATUS=$(npx supabase status -o json 2>"$STACK_STATUS_ERR"); then
  echo "Local Supabase stack is not running or 'supabase status' failed." >&2
  echo "Run 'npm run supabase:start' first." >&2
  cat "$STACK_STATUS_ERR" >&2
  rm -f "$STACK_STATUS_ERR"
  exit 1
fi
rm -f "$STACK_STATUS_ERR"

API_URL=$(echo "$STACK_STATUS" | jq -r '.API_URL')
ANON_KEY=$(echo "$STACK_STATUS" | jq -r '.ANON_KEY')
SERVICE_ROLE_KEY=$(echo "$STACK_STATUS" | jq -r '.SERVICE_ROLE_KEY')
DB_URL=$(echo "$STACK_STATUS" | jq -r '.DB_URL')

if [ -z "$API_URL" ] || [ "$API_URL" = "null" ] || [ -z "$DB_URL" ] || [ "$DB_URL" = "null" ]; then
  echo "Could not read API_URL/DB_URL from 'supabase status' output." >&2
  exit 1
fi

# Refuse to run against anything but the local stack - the one hard
# safety gate this script relies on for everything below, checked twice
# independently (API and DB), and a third time inside cli.ts itself.
if ! [[ "$API_URL" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)?(/.*)?$ ]]; then
  echo "Refusing to run: API_URL '$API_URL' is not localhost/127.0.0.1." >&2
  exit 1
fi
if ! [[ "$DB_URL" =~ ^postgres(ql)?://[^@]*@(127\.0\.0\.1|localhost)(:[0-9]+)?/ ]]; then
  echo "Refusing to run: DB_URL is not localhost/127.0.0.1." >&2
  exit 1
fi

if [ -z "$ANON_KEY" ] || [ "$ANON_KEY" = "null" ] || [ -z "$SERVICE_ROLE_KEY" ] || [ "$SERVICE_ROLE_KEY" = "null" ]; then
  echo "Could not read ANON_KEY/SERVICE_ROLE_KEY from 'supabase status' output." >&2
  exit 1
fi

DB_CONTAINER=""
if command -v docker >/dev/null 2>&1; then
  DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)
fi
if [ -z "$DB_CONTAINER" ]; then
  echo "Could not find a running supabase_db_* container - required to inspect the notifications schema" >&2
  echo "(deliberately unreachable via PostgREST, so this script reads it directly instead)." >&2
  exit 1
fi

# notifications.outbox/deliveries are NOT exposed via PostgREST by design
# (see docs/SECURITY_AND_PRIVACY.md) - the only way to inspect them, even
# with the service_role key, is a direct database connection. Every call
# site passes a literal SQL string (no shell interpolation of untrusted
# data - every value below is either this script's own generated UUID/
# token or a fixed literal).
psql_query() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -t -A -F'|' -c "$1"
}

PASS=0
FAIL=0
FAILURES=()

check() {
  local desc="$1" ok="$2"
  if [ "$ok" = "1" ]; then
    PASS=$((PASS + 1))
    echo "  ok   - $desc"
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$desc")
    echo "  FAIL - $desc"
  fi
}

# --- Cleanup: runs on any exit (success, failure, or interruption). Best
# effort - a cleanup failure is logged but never overrides the script's
# real exit code, and never re-triggers `set -e`. ---
CREATED_USER_IDS=()
FAMILY_ID=""

cleanup() {
  local exit_code=$?
  set +e
  if [ -n "$FAMILY_ID" ]; then
    # notifications.outbox/deliveries first (own private-schema rows,
    # not REST-reachable, so cleaned up via direct SQL) - then the same
    # task_assignments -> families order as e2e-backend.sh, for the same
    # composite-FK reason documented there.
    psql_query "delete from notifications.deliveries d using notifications.outbox o where d.outbox_id = o.id and o.family_id = '$FAMILY_ID';" >/dev/null
    psql_query "delete from notifications.outbox where family_id = '$FAMILY_ID';" >/dev/null
    curl -sS -o /dev/null -X DELETE "$API_URL/rest/v1/task_assignments?family_id=eq.$FAMILY_ID" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Prefer: return=minimal"
    curl -sS -o /dev/null -X DELETE "$API_URL/rest/v1/families?id=eq.$FAMILY_ID" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Prefer: return=minimal"
  fi
  for uid in "${CREATED_USER_IDS[@]:-}"; do
    [ -n "$uid" ] || continue
    # notification_tokens/notification_preferences have no FK cascade
    # from auth.users in this schema's own design (profile_id, not a
    # direct users FK) - clear them explicitly before deleting the user.
    curl -sS -o /dev/null -X DELETE "$API_URL/rest/v1/notification_tokens?profile_id=eq.$uid" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Prefer: return=minimal"
    curl -sS -o /dev/null -X DELETE "$API_URL/rest/v1/notification_preferences?profile_id=eq.$uid" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Prefer: return=minimal"
    curl -sS -o /dev/null -X DELETE "$API_URL/auth/v1/admin/users/$uid" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
  done
  rm -f /tmp/_e2e_notif_http_code
  exit "$exit_code"
}
trap cleanup EXIT

admin_create_user() {
  local email="$1" password="$2"
  local resp uid
  resp=$(curl -sS -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true}")
  uid=$(echo "$resp" | jq -r '.id // empty')
  # Deliberately does NOT append to CREATED_USER_IDS here: every call site
  # below invokes this via command substitution ($(...)), which runs the
  # function in a subshell - an array mutation here would be discarded the
  # instant that subshell exits, silently never reaching cleanup() (found
  # while building scripts/e2e-calendar.sh, Phase 7 - see docs/DECISIONS.md).
  # Every call site appends the returned id itself instead.
  echo "$uid"
}

sign_in() {
  local email="$1" password="$2"
  curl -sS -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" | jq -r '.access_token'
}

rpc() {
  local token="$1" fn="$2" body="$3"
  local resp
  resp=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$fn" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "$body")
  echo -n "$resp" | tail -1 >/tmp/_e2e_notif_http_code
  echo "$resp" | sed '$d'
}

rest_get() {
  local token="$1" path="$2"
  local resp
  # --globoff: token strings in the query string (e.g. "ExponentPushToken[...]")
  # contain [] which curl would otherwise try to interpret as a URL range.
  resp=$(curl -sS --globoff -w '\n%{http_code}' -X GET "$API_URL/rest/v1/$path" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token")
  echo -n "$resp" | tail -1 >/tmp/_e2e_notif_http_code
  echo "$resp" | sed '$d'
}

refresh_code() {
  HTTP_CODE=$(cat /tmp/_e2e_notif_http_code)
}

run_dispatcher() {
  local fail_token="${1:-}"
  local args=()
  [ -n "$fail_token" ] && args+=("--fail-token=$fail_token")
  # bash 3.2 (macOS default) treats "${args[@]}" on a genuinely empty
  # array as an unbound-variable error under `set -u` - the
  # ${args[@]+"${args[@]}"} form sidesteps that.
  SUPABASE_DB_URL="$DB_URL" deno run --allow-net --allow-env "$CLI_TS" ${args[@]+"${args[@]}"}
}

# Unique per run even for two invocations in the same second.
STAMP="$(date +%s)-$$-$RANDOM"
OWNER_EMAIL="e2e-notif-owner-$STAMP@example.com"
ADULTB_EMAIL="e2e-notif-adultb-$STAMP@example.com"
OUTSIDER_EMAIL="e2e-notif-outsider-$STAMP@example.com"
PASSWORD="Str0ngPassw0rd!"
OWNER_TOKEN_EXPO="ExponentPushToken[e2e-owner-$STAMP]"
ADULTB_TOKEN_EXPO="ExponentPushToken[e2e-adultb-$STAMP]"

echo "== Creating real auth.users accounts (admin API, pre-confirmed) =="
OWNER_ID=$(admin_create_user "$OWNER_EMAIL" "$PASSWORD")
CREATED_USER_IDS+=("$OWNER_ID")
ADULTB_ID=$(admin_create_user "$ADULTB_EMAIL" "$PASSWORD")
CREATED_USER_IDS+=("$ADULTB_ID")
OUTSIDER_ID=$(admin_create_user "$OUTSIDER_EMAIL" "$PASSWORD")
CREATED_USER_IDS+=("$OUTSIDER_ID")

OWNER_JWT=$(sign_in "$OWNER_EMAIL" "$PASSWORD")
ADULTB_JWT=$(sign_in "$ADULTB_EMAIL" "$PASSWORD")
OUTSIDER_JWT=$(sign_in "$OUTSIDER_EMAIL" "$PASSWORD")
check "all three users signed in with a real JWT" "$([ -n "$OWNER_JWT" ] && [ "$OWNER_JWT" != "null" ] && [ -n "$ADULTB_JWT" ] && [ "$ADULTB_JWT" != "null" ] && [ -n "$OUTSIDER_JWT" ] && [ "$OUTSIDER_JWT" != "null" ] && echo 1 || echo 0)"

echo "== Family creation and membership =="
FAMILY_RESP=$(rpc "$OWNER_JWT" "create_family_with_owner" '{"p_name":"E2E Notifications Family"}')
FAMILY_ID=$(echo "$FAMILY_RESP" | jq -r '.[0].family_id')
OWNER_MEMBER_ID=$(echo "$FAMILY_RESP" | jq -r '.[0].family_member_id')
check "owner created a family" "$([ -n "$FAMILY_ID" ] && [ "$FAMILY_ID" != "null" ] && echo 1 || echo 0)"

INVITE_TOKEN=$(rpc "$OWNER_JWT" "create_family_invitation" "{\"p_family_id\":\"$FAMILY_ID\",\"p_invited_email\":\"$ADULTB_EMAIL\"}" | jq -r '.[0].token')
ADULTB_MEMBER_ID=$(rpc "$ADULTB_JWT" "accept_family_invitation" "{\"p_token\":\"$INVITE_TOKEN\"}" | jq -r '.[0].family_member_id')
check "adult B accepted the invitation" "$([ -n "$ADULTB_MEMBER_ID" ] && [ "$ADULTB_MEMBER_ID" != "null" ] && echo 1 || echo 0)"

echo "== Registering real push tokens (register_notification_token RPC) =="
rpc "$OWNER_JWT" "register_notification_token" "{\"p_expo_push_token\":\"$OWNER_TOKEN_EXPO\",\"p_device_platform\":\"ios\"}" >/dev/null
rpc "$ADULTB_JWT" "register_notification_token" "{\"p_expo_push_token\":\"$ADULTB_TOKEN_EXPO\",\"p_device_platform\":\"android\"}" >/dev/null
OWNER_TOKEN_ROW=$(rest_get "$OWNER_JWT" "notification_tokens?expo_push_token=eq.$OWNER_TOKEN_EXPO&select=id,deactivated_at")
check "owner's push token was registered and active" "$([ "$(echo "$OWNER_TOKEN_ROW" | jq 'length')" -eq 1 ] && [ "$(echo "$OWNER_TOKEN_ROW" | jq -r '.[0].deactivated_at')" = "null" ] && echo 1 || echo 0)"

# register_notification_token always reassigns the token to the caller
# (see the migration's own comment on why - device resale/reinstall) -
# re-registering the SAME token string as a different user should move
# ownership, not error or create a duplicate row.
rpc "$ADULTB_JWT" "register_notification_token" "{\"p_expo_push_token\":\"$OWNER_TOKEN_EXPO\",\"p_device_platform\":\"ios\"}" >/dev/null
REASSIGNED_ROW=$(rest_get "$ADULTB_JWT" "notification_tokens?expo_push_token=eq.$OWNER_TOKEN_EXPO&select=id")
check "re-registering the owner's token string as adult B reassigns it to her" "$([ "$(echo "$REASSIGNED_ROW" | jq 'length')" -eq 1 ] && echo 1 || echo 0)"
check "the owner can no longer see that (now-reassigned) token row" "$([ "$(rest_get "$OWNER_JWT" "notification_tokens?expo_push_token=eq.$OWNER_TOKEN_EXPO&select=id" | jq 'length')" -eq 0 ] && echo 1 || echo 0)"
# Restore it to the owner for the rest of the flow below.
rpc "$OWNER_JWT" "register_notification_token" "{\"p_expo_push_token\":\"$OWNER_TOKEN_EXPO\",\"p_device_platform\":\"ios\"}" >/dev/null

echo "== Assignment mutations -> real outbox rows (verified by direct SQL) =="
TASK1_ID=$(rpc "$OWNER_JWT" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"E2E Task 1 - assign\"}" | jq -r '.')
rpc "$OWNER_JWT" "assign_family_task" "{\"p_task_id\":\"$TASK1_ID\",\"p_assignee_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
ROW1=$(psql_query "select event_type, status from notifications.outbox where task_id = '$TASK1_ID';")
check "assigning task 1 enqueued a pending 'assignment_requested' outbox row" "$([ "$ROW1" = "family_task.assignment_requested.v1|pending" ] && echo 1 || echo 0)"

rpc "$ADULTB_JWT" "accept_task_assignment" "{\"p_task_id\":\"$TASK1_ID\"}" >/dev/null
ROW1B=$(psql_query "select event_type, status from notifications.outbox where task_id = '$TASK1_ID' and event_type = 'family_task.assignment_accepted.v1';")
check "accepting task 1 enqueued a pending 'assignment_accepted' outbox row" "$([ "$ROW1B" = "family_task.assignment_accepted.v1|pending" ] && echo 1 || echo 0)"

TASK2_ID=$(rpc "$OWNER_JWT" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"E2E Task 2 - decline\"}" | jq -r '.')
rpc "$OWNER_JWT" "assign_family_task" "{\"p_task_id\":\"$TASK2_ID\",\"p_assignee_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
rpc "$ADULTB_JWT" "decline_task_assignment" "{\"p_task_id\":\"$TASK2_ID\"}" >/dev/null
ROW2=$(psql_query "select event_type, status from notifications.outbox where task_id = '$TASK2_ID' and event_type = 'family_task.assignment_declined.v1';")
check "declining task 2 enqueued a pending 'assignment_declined' outbox row" "$([ "$ROW2" = "family_task.assignment_declined.v1|pending" ] && echo 1 || echo 0)"

TASK3_ID=$(rpc "$OWNER_JWT" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"E2E Task 3 - take\"}" | jq -r '.')
rpc "$ADULTB_JWT" "take_family_task" "{\"p_task_id\":\"$TASK3_ID\"}" >/dev/null
ROW3=$(psql_query "select event_type, status, recipient_member_id from notifications.outbox where task_id = '$TASK3_ID' and event_type = 'family_task.assignment_taken.v1';")
check "adult B taking task 3 enqueued a pending 'assignment_taken' outbox row for the owner" "$(echo "$ROW3" | grep -q "^family_task.assignment_taken.v1|pending|$OWNER_MEMBER_ID$" && echo 1 || echo 0)"

echo "== Self-notification suppression =="
TASK4_ID=$(rpc "$OWNER_JWT" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"E2E Task 4 - self-assign\"}" | jq -r '.')
BEFORE_COUNT=$(psql_query "select count(*) from notifications.outbox where family_id = '$FAMILY_ID';")
rpc "$OWNER_JWT" "assign_family_task" "{\"p_task_id\":\"$TASK4_ID\",\"p_assignee_member_id\":\"$OWNER_MEMBER_ID\"}" >/dev/null
AFTER_COUNT=$(psql_query "select count(*) from notifications.outbox where family_id = '$FAMILY_ID';")
check "the owner assigning a task to themself never enqueues an outbox row" "$([ "$BEFORE_COUNT" = "$AFTER_COUNT" ] && echo 1 || echo 0)"

echo "== Dispatch: real Edge Function code, fake Expo transport, real DB =="
# 5 pending rows by this point: task 1 -> requested + accepted, task 2 ->
# requested + declined, task 3 -> taken. Task 4's self-assignment
# contributed none (checked above).
DISPATCH1=$(run_dispatcher)
echo "  $DISPATCH1"
CLAIMED1=$(echo "$DISPATCH1" | jq -r '.result.claimed')
SENT1=$(echo "$DISPATCH1" | jq -r '.result.sent')
SENT_MSGS1=$(echo "$DISPATCH1" | jq -r '.sentMessageCount')
check "first dispatch claimed all 5 pending outbox rows" "$([ "$CLAIMED1" = "5" ] && echo 1 || echo 0)"
check "first dispatch sent all 5 (fake transport, no real network call)" "$([ "$SENT1" = "5" ] && echo 1 || echo 0)"
check "first dispatch attempted deliveries to the fake transport (>=5 messages, both testers hold tokens)" "$([ "$SENT_MSGS1" -ge 5 ] && echo 1 || echo 0)"

STATUS_AFTER_DISPATCH=$(psql_query "select count(*) from notifications.outbox where family_id = '$FAMILY_ID' and status = 'sent';")
check "all 5 outbox rows are now 'sent' (verified by direct SQL)" "$([ "$STATUS_AFTER_DISPATCH" = "5" ] && echo 1 || echo 0)"
DELIVERY_STATUS=$(psql_query "select count(*) from notifications.deliveries d join notifications.outbox o on o.id = d.outbox_id where o.family_id = '$FAMILY_ID' and d.status = 'ticket_ok';")
check "all 5 delivery rows reached ticket_ok with a ticket id" "$([ "$DELIVERY_STATUS" = "5" ] && echo 1 || echo 0)"

echo "== Deduplication: a second dispatch must not reprocess already-sent rows =="
DISPATCH2=$(run_dispatcher)
echo "  $DISPATCH2"
CLAIMED2=$(echo "$DISPATCH2" | jq -r '.result.claimed')
check "second dispatch claims nothing new (already-sent rows are not reprocessed)" "$([ "$CLAIMED2" = "0" ] && echo 1 || echo 0)"

echo "== DeviceNotRegistered -> token deactivation on a fresh event =="
TASK5_ID=$(rpc "$OWNER_JWT" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"E2E Task 5 - deactivation\"}" | jq -r '.')
rpc "$OWNER_JWT" "assign_family_task" "{\"p_task_id\":\"$TASK5_ID\",\"p_assignee_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
DISPATCH3=$(run_dispatcher "$ADULTB_TOKEN_EXPO")
echo "  $DISPATCH3"
DEACTIVATED_COUNT=$(echo "$DISPATCH3" | jq -r '.result.deliveriesDeactivatedTokens')
check "dispatch classified the simulated DeviceNotRegistered error and deactivated the token" "$([ "$DEACTIVATED_COUNT" -ge 1 ] && echo 1 || echo 0)"
ADULTB_TOKEN_ROW=$(psql_query "select deactivated_at is not null from public.notification_tokens where expo_push_token = '$ADULTB_TOKEN_EXPO';")
check "adult B's token is deactivated in the database" "$([ "$ADULTB_TOKEN_ROW" = "t" ] && echo 1 || echo 0)"

echo "== A recipient with only a deactivated token yields a skipped outbox row =="
TASK6_ID=$(rpc "$OWNER_JWT" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"E2E Task 6 - post-deactivation\"}" | jq -r '.')
rpc "$OWNER_JWT" "assign_family_task" "{\"p_task_id\":\"$TASK6_ID\",\"p_assignee_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
run_dispatcher >/dev/null
ROW6=$(psql_query "select status from notifications.outbox where task_id = '$TASK6_ID';")
check "task 6's outbox row is 'skipped' (adult B's only token is now deactivated)" "$([ "$ROW6" = "skipped" ] && echo 1 || echo 0)"

echo "== Authorization boundaries =="
NOTIF_SCHEMA_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X GET "$API_URL/rest/v1/outbox" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")
check "notifications.outbox is unreachable via the REST API even with service_role (HTTP $NOTIF_SCHEMA_CODE)" "$([ "$NOTIF_SCHEMA_CODE" -ge 400 ] && echo 1 || echo 0)"

OUTSIDER_SEES_TOKENS=$(rest_get "$OUTSIDER_JWT" "notification_tokens?profile_id=eq.$ADULTB_ID&select=id")
check "an outsider cannot read adult B's notification_tokens row (RLS)" "$([ "$OUTSIDER_SEES_TOKENS" = "[]" ] && echo 1 || echo 0)"

OUTSIDER_SEES_PREFS=$(rest_get "$OUTSIDER_JWT" "notification_preferences?profile_id=eq.$ADULTB_ID&select=profile_id")
check "an outsider cannot read adult B's notification_preferences row (RLS)" "$([ "$OUTSIDER_SEES_PREFS" = "[]" ] && echo 1 || echo 0)"

rpc "$OUTSIDER_JWT" "register_notification_token" "{\"p_expo_push_token\":\"ExponentPushToken[e2e-outsider-$STAMP]\",\"p_device_platform\":\"ios\"}" >/dev/null
refresh_code
check "an outsider (no family membership needed) can still register their own token (HTTP $HTTP_CODE, self-scoped)" "$([ "$HTTP_CODE" -lt 300 ] && echo 1 || echo 0)"

echo
echo "=================================================="
echo "Real notification backend integration: $PASS passed, $FAIL failed"
echo "=================================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
