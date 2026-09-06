#!/usr/bin/env bash
# Real multi-user backend integration flow for the shared-family-task
# assignment workflow (Phase 5). Exercises the actual RPC/RLS surface
# against a live local Postgres instance with real auth.users accounts -
# not pgTAP's simulated `set local role` personas, and not a mocked
# Supabase client. Complements, does not replace, `npm run db:test`.
#
# LOCAL SUPABASE ONLY. Every URL this script talks to is read from
# `supabase status` and verified to resolve to 127.0.0.1/localhost before
# a single request is sent - this script refuses to run against anything
# else, including a real/staging/production project.
#
# Usage: npm run e2e:backend
# Prerequisite: the local Supabase stack running (npm run supabase:start)
# with a fresh `npm run db:reset` recommended so `check()` failure counts
# are meaningful, though every identity this script creates is unique per
# run and cleaned up on exit either way (see `cleanup` below), so a repeat
# run against non-reset data is also safe.
set -euo pipefail

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

if [ -z "$API_URL" ] || [ "$API_URL" = "null" ]; then
  echo "Could not read API_URL from 'supabase status' output." >&2
  exit 1
fi

# Refuse to run against anything but the local stack. This is the one
# hard safety gate in this script - everything else assumes it held.
if ! [[ "$API_URL" =~ ^https?://(127\.0\.0\.1|localhost)(:[0-9]+)?(/.*)?$ ]]; then
  echo "Refusing to run: API_URL '$API_URL' is not localhost/127.0.0.1." >&2
  echo "This script only ever runs against a local Supabase stack." >&2
  exit 1
fi

if [ -z "$ANON_KEY" ] || [ "$ANON_KEY" = "null" ] || [ -z "$SERVICE_ROLE_KEY" ] || [ "$SERVICE_ROLE_KEY" = "null" ]; then
  echo "Could not read ANON_KEY/SERVICE_ROLE_KEY from 'supabase status' output." >&2
  exit 1
fi
# Neither key is ever echoed, logged, or included in any [debug] line below
# - only used as curl header values.

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
    # task_assignments carries its own denormalized family_id and has a
    # composite FK to family_members (assigned_to_member_id, family_id)
    # that is NOT cascaded - deleting `families` directly first hits that
    # FK via family_members' own cascade attempt (409). Clear
    # task_assignments for this family first; `families` cascades tasks,
    # family_members, and family_invitations cleanly from there.
    curl -sS -o /dev/null -X DELETE "$API_URL/rest/v1/task_assignments?family_id=eq.$FAMILY_ID" \
      -H "apikey: $SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H "Prefer: return=minimal"
    curl -sS -o /dev/null -X DELETE "$API_URL/rest/v1/families?id=eq.$FAMILY_ID" \
      -H "apikey: $SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H "Prefer: return=minimal"
  fi
  for uid in "${CREATED_USER_IDS[@]:-}"; do
    [ -n "$uid" ] || continue
    curl -sS -o /dev/null -X DELETE "$API_URL/auth/v1/admin/users/$uid" \
      -H "apikey: $SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SERVICE_ROLE_KEY"
  done
  rm -f /tmp/_e2e_backend_http_code /tmp/e2e_backend_take_*.json /tmp/e2e_backend_take_*_code.txt
  exit "$exit_code"
}
trap cleanup EXIT

admin_create_user() {
  local email="$1" password="$2"
  local resp uid
  resp=$(curl -sS -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"email_confirm\":true}")
  uid=$(echo "$resp" | jq -r '.id // empty')
  [ -n "$uid" ] && CREATED_USER_IDS+=("$uid")
}

sign_in() {
  local email="$1" password="$2"
  curl -sS -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" | jq -r '.access_token'
}

# rpc TOKEN fn json_body -> prints raw body; sets HTTP_CODE (via refresh_code)
rpc() {
  local token="$1" fn="$2" body="$3"
  local resp
  resp=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL/rest/v1/rpc/$fn" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$body")
  echo -n "$resp" | tail -1 >/tmp/_e2e_backend_http_code
  echo "$resp" | sed '$d'
}

rest_get() {
  local token="$1" path="$2"
  local resp
  resp=$(curl -sS -w '\n%{http_code}' -X GET "$API_URL/rest/v1/$path" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $token")
  echo -n "$resp" | tail -1 >/tmp/_e2e_backend_http_code
  echo "$resp" | sed '$d'
}

rest_patch() {
  local token="$1" path="$2" body="$3"
  local resp
  resp=$(curl -sS -w '\n%{http_code}' -X PATCH "$API_URL/rest/v1/$path" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" \
    -d "$body")
  echo -n "$resp" | tail -1 >/tmp/_e2e_backend_http_code
  echo "$resp" | sed '$d'
}

refresh_code() {
  HTTP_CODE=$(cat /tmp/_e2e_backend_http_code)
}

# Unique per run even for two invocations in the same second.
STAMP="$(date +%s)-$$-$RANDOM"
OWNER_EMAIL="e2e-backend-owner-$STAMP@example.com"
ADULTB_EMAIL="e2e-backend-adultb-$STAMP@example.com"
OUTSIDER_EMAIL="e2e-backend-outsider-$STAMP@example.com"
PASSWORD="Str0ngPassw0rd!"

echo "== Creating real auth.users accounts (admin API, pre-confirmed) =="
admin_create_user "$OWNER_EMAIL" "$PASSWORD"
admin_create_user "$ADULTB_EMAIL" "$PASSWORD"
admin_create_user "$OUTSIDER_EMAIL" "$PASSWORD"

OWNER_TOKEN=$(sign_in "$OWNER_EMAIL" "$PASSWORD")
ADULTB_TOKEN=$(sign_in "$ADULTB_EMAIL" "$PASSWORD")
OUTSIDER_TOKEN=$(sign_in "$OUTSIDER_EMAIL" "$PASSWORD")

check "owner signed in with a real JWT" "$([ -n "$OWNER_TOKEN" ] && [ "$OWNER_TOKEN" != "null" ] && echo 1 || echo 0)"
check "adult B signed in with a real JWT" "$([ -n "$ADULTB_TOKEN" ] && [ "$ADULTB_TOKEN" != "null" ] && echo 1 || echo 0)"
check "outsider signed in with a real JWT" "$([ -n "$OUTSIDER_TOKEN" ] && [ "$OUTSIDER_TOKEN" != "null" ] && echo 1 || echo 0)"

echo "== Family creation and membership =="
FAMILY_RESP=$(rpc "$OWNER_TOKEN" "create_family_with_owner" '{"p_name":"E2E Backend Family"}')
FAMILY_ID=$(echo "$FAMILY_RESP" | jq -r '.[0].family_id')
OWNER_MEMBER_ID=$(echo "$FAMILY_RESP" | jq -r '.[0].family_member_id')
check "owner created a family (family_id, family_member_id returned)" "$([ -n "$FAMILY_ID" ] && [ "$FAMILY_ID" != "null" ] && [ -n "$OWNER_MEMBER_ID" ] && [ "$OWNER_MEMBER_ID" != "null" ] && echo 1 || echo 0)"

INVITE_RESP=$(rpc "$OWNER_TOKEN" "create_family_invitation" "{\"p_family_id\":\"$FAMILY_ID\",\"p_invited_email\":\"$ADULTB_EMAIL\"}")
INVITE_TOKEN=$(echo "$INVITE_RESP" | jq -r '.[0].token')
check "owner created an invitation for adult B" "$([ -n "$INVITE_TOKEN" ] && [ "$INVITE_TOKEN" != "null" ] && echo 1 || echo 0)"

ACCEPT_RESP=$(rpc "$ADULTB_TOKEN" "accept_family_invitation" "{\"p_token\":\"$INVITE_TOKEN\"}")
ADULTB_MEMBER_ID=$(echo "$ACCEPT_RESP" | jq -r '.[0].family_member_id')
check "adult B accepted the invitation and got a family_members row" "$([ -n "$ADULTB_MEMBER_ID" ] && [ "$ADULTB_MEMBER_ID" != "null" ] && echo 1 || echo 0)"

echo "== Privacy isolation: outsider must not see this family =="
OUT_TASKS=$(rest_get "$OUTSIDER_TOKEN" "tasks?family_id=eq.$FAMILY_ID&select=id")
check "outsider sees zero tasks for this family (before any exist)" "$([ "$OUT_TASKS" = "[]" ] && echo 1 || echo 0)"

echo "== Shared task creation, assignment, acceptance =="
TASK1_RESP=$(rpc "$OWNER_TOKEN" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"Task 1 - assign then reassign\"}")
TASK1_ID=$(echo "$TASK1_RESP" | jq -r '.')
check "owner created shared task 1 (unassigned)" "$([ -n "$TASK1_ID" ] && [ "$TASK1_ID" != "null" ] && echo 1 || echo 0)"

rpc "$OWNER_TOKEN" "assign_family_task" "{\"p_task_id\":\"$TASK1_ID\",\"p_assignee_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
STATUS_AFTER_ASSIGN=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK1_ID&select=assignment_status" | jq -r '.[0].assignment_status')
check "assigning to adult B moves task 1 to pending_acceptance" "$([ "$STATUS_AFTER_ASSIGN" = "pending_acceptance" ] && echo 1 || echo 0)"

rpc "$ADULTB_TOKEN" "accept_task_assignment" "{\"p_task_id\":\"$TASK1_ID\"}" >/dev/null
STATUS_AFTER_ACCEPT=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK1_ID&select=assignment_status" | jq -r '.[0].assignment_status')
check "adult B accepting moves task 1 to accepted" "$([ "$STATUS_AFTER_ACCEPT" = "accepted" ] && echo 1 || echo 0)"

echo "== Decline =="
TASK2_ID=$(rpc "$OWNER_TOKEN" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"Task 2 - decline\"}" | jq -r '.')
rpc "$OWNER_TOKEN" "assign_family_task" "{\"p_task_id\":\"$TASK2_ID\",\"p_assignee_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
rpc "$ADULTB_TOKEN" "decline_task_assignment" "{\"p_task_id\":\"$TASK2_ID\"}" >/dev/null
STATUS_AFTER_DECLINE=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK2_ID&select=assignment_status" | jq -r '.[0].assignment_status')
check "declining resolves task 2 back to unassigned" "$([ "$STATUS_AFTER_DECLINE" = "unassigned" ] && echo 1 || echo 0)"
DECLINE_AUDIT=$(rest_get "$OWNER_TOKEN" "task_assignments?task_id=eq.$TASK2_ID&action=eq.declined&select=id")
check "a 'declined' audit row exists for task 2 (kept, not deleted)" "$([ "$(echo "$DECLINE_AUDIT" | jq 'length')" -ge 1 ] && echo 1 || echo 0)"

echo "== Concurrent Take Task (real parallel requests) =="
TASK3_ID=$(rpc "$OWNER_TOKEN" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"Task 3 - concurrent take\"}" | jq -r '.')
curl -sS -o /tmp/e2e_backend_take_owner.json -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/take_family_task" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $OWNER_TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_task_id\":\"$TASK3_ID\"}" >/tmp/e2e_backend_take_owner_code.txt &
PID1=$!
curl -sS -o /tmp/e2e_backend_take_adultb.json -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/take_family_task" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ADULTB_TOKEN" -H "Content-Type: application/json" \
  -d "{\"p_task_id\":\"$TASK3_ID\"}" >/tmp/e2e_backend_take_adultb_code.txt &
PID2=$!
wait "$PID1" "$PID2"

CODE_OWNER=$(cat /tmp/e2e_backend_take_owner_code.txt)
CODE_ADULTB=$(cat /tmp/e2e_backend_take_adultb_code.txt)
SUCCESSES=0
[ "$CODE_OWNER" = "204" ] && SUCCESSES=$((SUCCESSES + 1))
[ "$CODE_ADULTB" = "204" ] && SUCCESSES=$((SUCCESSES + 1))
check "exactly one concurrent Take Task call succeeded (owner=$CODE_OWNER, adultB=$CODE_ADULTB)" "$([ "$SUCCESSES" -eq 1 ] && echo 1 || echo 0)"

TASK3_TOOK_ROWS=$(rest_get "$OWNER_TOKEN" "task_assignments?task_id=eq.$TASK3_ID&action=eq.took&select=id")
check "exactly one 'took' audit row exists for task 3 (no duplicate active assignment)" "$([ "$(echo "$TASK3_TOOK_ROWS" | jq 'length')" -eq 1 ] && echo 1 || echo 0)"

echo "== Reassignment: self-target (immediate accept) and stale-recipient rejection =="
# Task 1 is currently 'accepted' by adult B. Reassigning to the owner (the
# caller themself) hits set_task_assignment's self-assign override, which
# records a single 'accepted' row directly rather than a 'reassigned' row
# followed by a separate accept - the same shortcut Take Task and
# self-assignment use. Adult B, the just-superseded former assignee, must
# no longer be able to accept.
rpc "$OWNER_TOKEN" "reassign_family_task" "{\"p_task_id\":\"$TASK1_ID\",\"p_assignee_member_id\":\"$OWNER_MEMBER_ID\"}" >/dev/null
STATUS_AFTER_SELF_REASSIGN=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK1_ID&select=assignment_status" | jq -r '.[0].assignment_status')
check "reassigning task 1 to the caller themself immediately accepts it (self-assign shortcut)" "$([ "$STATUS_AFTER_SELF_REASSIGN" = "accepted" ] && echo 1 || echo 0)"

rpc "$ADULTB_TOKEN" "accept_task_assignment" "{\"p_task_id\":\"$TASK1_ID\"}" >/dev/null
refresh_code
check "adult B (the just-superseded former assignee) cannot accept task 1 (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"

echo "== Reassignment: to a genuinely different member (pending_acceptance) =="
# Task 1 is now 'accepted' by the owner. Reassigning it to adult B (not the
# caller) must go through the real pending path, not the self-shortcut.
rpc "$OWNER_TOKEN" "reassign_family_task" "{\"p_task_id\":\"$TASK1_ID\",\"p_assignee_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
STATUS_AFTER_OTHER_REASSIGN=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK1_ID&select=assignment_status" | jq -r '.[0].assignment_status')
check "reassigning task 1 to adult B (not the caller) moves it to pending_acceptance" "$([ "$STATUS_AFTER_OTHER_REASSIGN" = "pending_acceptance" ] && echo 1 || echo 0)"

rpc "$ADULTB_TOKEN" "accept_task_assignment" "{\"p_task_id\":\"$TASK1_ID\"}" >/dev/null
STATUS_ADULTB_ACCEPTED=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK1_ID&select=assignment_status" | jq -r '.[0].assignment_status')
check "adult B accepts the reassigned task 1" "$([ "$STATUS_ADULTB_ACCEPTED" = "accepted" ] && echo 1 || echo 0)"

echo "== Completion and restore =="
rpc "$OWNER_TOKEN" "complete_shared_task" "{\"p_task_id\":\"$TASK1_ID\"}" >/dev/null
COMPLETED_AT=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK1_ID&select=completed_at" | jq -r '.[0].completed_at')
check "task 1 is completed" "$([ -n "$COMPLETED_AT" ] && [ "$COMPLETED_AT" != "null" ] && echo 1 || echo 0)"

rpc "$OWNER_TOKEN" "reassign_family_task" "{\"p_task_id\":\"$TASK1_ID\",\"p_assignee_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
refresh_code
check "cannot reassign a completed task without restoring first (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"

rpc "$OWNER_TOKEN" "restore_shared_task" "{\"p_task_id\":\"$TASK1_ID\"}" >/dev/null
COMPLETED_AT_AFTER_RESTORE=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK1_ID&select=completed_at" | jq -r '.[0].completed_at')
check "task 1 restored (completed_at cleared)" "$([ "$COMPLETED_AT_AFTER_RESTORE" = "null" ] && echo 1 || echo 0)"

echo "== Member removal resolves active assignments =="
TASK4_ID=$(rpc "$OWNER_TOKEN" "create_shared_family_task" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"Task 4 - member removal\"}" | jq -r '.')
rpc "$OWNER_TOKEN" "assign_family_task" "{\"p_task_id\":\"$TASK4_ID\",\"p_assignee_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
rpc "$ADULTB_TOKEN" "accept_task_assignment" "{\"p_task_id\":\"$TASK4_ID\"}" >/dev/null
STATUS_BEFORE_REMOVAL=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK4_ID&select=assignment_status" | jq -r '.[0].assignment_status')
check "task 4 accepted by adult B before removal" "$([ "$STATUS_BEFORE_REMOVAL" = "accepted" ] && echo 1 || echo 0)"

rpc "$OWNER_TOKEN" "remove_family_member" "{\"p_member_id\":\"$ADULTB_MEMBER_ID\"}" >/dev/null
STATUS_AFTER_REMOVAL=$(rest_get "$OWNER_TOKEN" "tasks?id=eq.$TASK4_ID&select=assignment_status" | jq -r '.[0].assignment_status')
check "task 4 resolved back to unassigned after removing adult B" "$([ "$STATUS_AFTER_REMOVAL" = "unassigned" ] && echo 1 || echo 0)"

REMOVAL_AUDIT=$(rest_get "$OWNER_TOKEN" "task_assignments?task_id=eq.$TASK4_ID&action=eq.unassigned&select=id")
check "an 'unassigned' audit row exists for task 4's removal-triggered resolution" "$([ "$(echo "$REMOVAL_AUDIT" | jq 'length')" -ge 1 ] && echo 1 || echo 0)"

ADULTB_TASKS_AFTER_REMOVAL=$(rest_get "$ADULTB_TOKEN" "tasks?family_id=eq.$FAMILY_ID&select=id")
check "removed adult B loses access to the family's tasks immediately" "$([ "$ADULTB_TASKS_AFTER_REMOVAL" = "[]" ] && echo 1 || echo 0)"

rpc "$ADULTB_TOKEN" "take_family_task" "{\"p_task_id\":\"$TASK3_ID\"}" >/dev/null
refresh_code
check "removed adult B can no longer call shared-task RPCs (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"

echo "== Privacy isolation (with real data now in place) =="
OUT_TASKS_2=$(rest_get "$OUTSIDER_TOKEN" "tasks?family_id=eq.$FAMILY_ID&select=id")
check "outsider still sees zero tasks for this family" "$([ "$OUT_TASKS_2" = "[]" ] && echo 1 || echo 0)"

rpc "$OUTSIDER_TOKEN" "take_family_task" "{\"p_task_id\":\"$TASK3_ID\"}" >/dev/null
refresh_code
check "outsider cannot Take a task in a family they don't belong to (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"

ANON_TASKS=$(curl -sS -w '\n%{http_code}' -X GET "$API_URL/rest/v1/tasks?family_id=eq.$FAMILY_ID&select=id" -H "apikey: $ANON_KEY")
ANON_BODY=$(echo "$ANON_TASKS" | sed '$d')
# Either shape is safe: an empty array (RLS-filtered) or a permission-denied
# error (no SELECT grant at all - a *stronger* guarantee). Either way, no
# row of this family's data reaches an anonymous caller.
ANON_SAFE=0
[ "$ANON_BODY" = "[]" ] && ANON_SAFE=1
echo "$ANON_BODY" | jq -e '.code == "42501"' >/dev/null 2>&1 && ANON_SAFE=1
check "anonymous request never receives any row of this family's tasks" "$ANON_SAFE"

ANON_RPC_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API_URL/rest/v1/rpc/take_family_task" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d "{\"p_task_id\":\"$TASK3_ID\"}")
check "anonymous call to take_family_task is rejected (HTTP $ANON_RPC_CODE)" "$([ "$ANON_RPC_CODE" -ge 400 ] && echo 1 || echo 0)"

echo "== Audit trail is append-only (no UPDATE/DELETE grant) =="
SOME_AUDIT_ID=$(rest_get "$OWNER_TOKEN" "task_assignments?task_id=eq.$TASK1_ID&select=id&limit=1" | jq -r '.[0].id')
rest_patch "$OWNER_TOKEN" "task_assignments?id=eq.$SOME_AUDIT_ID" '{"action":"accepted"}' >/dev/null
refresh_code
check "owner cannot UPDATE a task_assignments audit row directly (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"

FULL_AUDIT_TASK1=$(rest_get "$OWNER_TOKEN" "task_assignments?task_id=eq.$TASK1_ID&select=action&order=created_at.asc")
AUDIT_ACTIONS_TASK1=$(echo "$FULL_AUDIT_TASK1" | jq -r '[.[].action] | join(",")')
# Task 1 was still held (accepted) by adult B when she was removed in the
# member-removal section above, on top of task 4 - remove_family_member
# resolves *every* active assignment for the removed member, not just one
# task, so a trailing 'unassigned' row here is the correct cross-task proof
# of that fix, not test noise.
EXPECTED_ACTIONS="assigned,accepted,accepted,reassigned,accepted,unassigned"
check "task 1's full audit history is intact and append-only ($EXPECTED_ACTIONS)" "$([ "$AUDIT_ACTIONS_TASK1" = "$EXPECTED_ACTIONS" ] && echo 1 || echo 0)"

echo
echo "=================================================="
echo "Real backend integration: $PASS passed, $FAIL failed"
echo "=================================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
