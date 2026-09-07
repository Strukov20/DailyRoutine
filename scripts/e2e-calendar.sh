#!/usr/bin/env bash
# Real multi-user backend integration flow for the family calendar
# (Phase 7): personal/family/child events, the event <> responsibility
# rule, the responsibility assignment state machine, Busy-block privacy,
# deterministic conflict detection, and the notification outbox extension
# — all against the real RPC/RLS/trigger surface on a live local Postgres
# instance. Mirrors scripts/e2e-backend.sh and scripts/e2e-notifications.sh's
# established safety/cleanup discipline exactly.
#
# LOCAL SUPABASE ONLY. Every URL/connection string this script uses is
# read from `supabase status` and verified to resolve to
# 127.0.0.1/localhost before a single request is sent or a single
# connection is opened.
#
# Usage: npm run e2e:calendar
# Prerequisite: the local Supabase stack running (npm run supabase:start).
# Every identity/row this script creates is unique per run and cleaned up
# on exit (see `cleanup` below), so a repeat run is safe without a DB
# reset in between.
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
DB_URL=$(echo "$STACK_STATUS" | jq -r '.DB_URL')

if [ -z "$API_URL" ] || [ "$API_URL" = "null" ] || [ -z "$DB_URL" ] || [ "$DB_URL" = "null" ]; then
  echo "Could not read API_URL/DB_URL from 'supabase status' output." >&2
  exit 1
fi
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
  echo "Could not find a running supabase_db_* container - required for direct notifications-schema/secret-marker inspection." >&2
  exit 1
fi

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

CREATED_USER_IDS=()
FAMILY_ID=""

cleanup() {
  local exit_code=$?
  set +e
  if [ -n "$FAMILY_ID" ]; then
    # notifications.outbox/deliveries first (not REST-reachable), then
    # responsibility_assignments/responsibilities/event_participants/events
    # before families - task_assignments-style composite FKs mean children
    # must go before their parents. See scripts/e2e-backend.sh's own
    # comment for the identical FK-ordering reason.
    psql_query "delete from notifications.deliveries d using notifications.outbox o where d.outbox_id = o.id and o.family_id = '$FAMILY_ID';" >/dev/null
    psql_query "delete from notifications.outbox where family_id = '$FAMILY_ID';" >/dev/null
    psql_query "delete from public.responsibility_assignments where family_id = '$FAMILY_ID';" >/dev/null
    psql_query "delete from public.responsibilities where family_id = '$FAMILY_ID';" >/dev/null
    psql_query "delete from public.event_participants where family_id = '$FAMILY_ID';" >/dev/null
    psql_query "delete from public.events where family_id = '$FAMILY_ID';" >/dev/null
    curl -sS -o /dev/null -X DELETE "$API_URL/rest/v1/task_assignments?family_id=eq.$FAMILY_ID" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Prefer: return=minimal"
    curl -sS -o /dev/null -X DELETE "$API_URL/rest/v1/families?id=eq.$FAMILY_ID" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Prefer: return=minimal"
  fi
  for uid in "${CREATED_USER_IDS[@]:-}"; do
    [ -n "$uid" ] || continue
    psql_query "delete from public.events where owner_profile_id = '$uid';" >/dev/null
    curl -sS -o /dev/null -X DELETE "$API_URL/auth/v1/admin/users/$uid" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
  done
  rm -f /tmp/_e2e_calendar_http_code
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
  # instant that subshell exits, silently never reaching cleanup(). Every
  # call site appends the returned id itself instead.
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
  echo -n "$resp" | tail -1 >/tmp/_e2e_calendar_http_code
  echo "$resp" | sed '$d'
}

rest_get() {
  local token="$1" path="$2"
  local resp
  resp=$(curl -sS -w '\n%{http_code}' -X GET "$API_URL/rest/v1/$path" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token")
  echo -n "$resp" | tail -1 >/tmp/_e2e_calendar_http_code
  echo "$resp" | sed '$d'
}

refresh_code() {
  HTTP_CODE=$(cat /tmp/_e2e_calendar_http_code)
}

STAMP="$(date +%s)-$$-$RANDOM"
OWNER_EMAIL="e2e-cal-owner-$STAMP@example.com"
SPOUSE_EMAIL="e2e-cal-spouse-$STAMP@example.com"
OUTSIDER_EMAIL="e2e-cal-outsider-$STAMP@example.com"
PASSWORD="Str0ngPassw0rd!"

echo "== Creating real auth.users accounts (admin API, pre-confirmed) =="
OWNER_ID=$(admin_create_user "$OWNER_EMAIL" "$PASSWORD")
CREATED_USER_IDS+=("$OWNER_ID")
SPOUSE_ID=$(admin_create_user "$SPOUSE_EMAIL" "$PASSWORD")
CREATED_USER_IDS+=("$SPOUSE_ID")
OUTSIDER_ID=$(admin_create_user "$OUTSIDER_EMAIL" "$PASSWORD")
CREATED_USER_IDS+=("$OUTSIDER_ID")

OWNER_JWT=$(sign_in "$OWNER_EMAIL" "$PASSWORD")
SPOUSE_JWT=$(sign_in "$SPOUSE_EMAIL" "$PASSWORD")
OUTSIDER_JWT=$(sign_in "$OUTSIDER_EMAIL" "$PASSWORD")
check "all three users signed in with a real JWT" "$([ -n "$OWNER_JWT" ] && [ "$OWNER_JWT" != "null" ] && [ -n "$SPOUSE_JWT" ] && [ "$SPOUSE_JWT" != "null" ] && [ -n "$OUTSIDER_JWT" ] && [ "$OUTSIDER_JWT" != "null" ] && echo 1 || echo 0)"

echo "== Family, spouse invitation, and a child profile (Step 1) =="
FAMILY_RESP=$(rpc "$OWNER_JWT" "create_family_with_owner" '{"p_name":"E2E Calendar Family"}')
FAMILY_ID=$(echo "$FAMILY_RESP" | jq -r '.[0].family_id')
OWNER_MEMBER_ID=$(echo "$FAMILY_RESP" | jq -r '.[0].family_member_id')
check "owner created a family" "$([ -n "$FAMILY_ID" ] && [ "$FAMILY_ID" != "null" ] && echo 1 || echo 0)"

INVITE_TOKEN=$(rpc "$OWNER_JWT" "create_family_invitation" "{\"p_family_id\":\"$FAMILY_ID\",\"p_invited_email\":\"$SPOUSE_EMAIL\"}" | jq -r '.[0].token')
SPOUSE_MEMBER_ID=$(rpc "$SPOUSE_JWT" "accept_family_invitation" "{\"p_token\":\"$INVITE_TOKEN\"}" | jq -r '.[0].family_member_id')
check "spouse accepted the invitation" "$([ -n "$SPOUSE_MEMBER_ID" ] && [ "$SPOUSE_MEMBER_ID" != "null" ] && echo 1 || echo 0)"

CHILD_MEMBER_ID=$(rpc "$OWNER_JWT" "create_child_profile" "{\"p_family_id\":\"$FAMILY_ID\",\"p_display_name\":\"Artem\"}" | jq -r '.')
check "owner created a child profile" "$([ -n "$CHILD_MEMBER_ID" ] && [ "$CHILD_MEMBER_ID" != "null" ] && echo 1 || echo 0)"

echo "== Private adult event + Busy-block privacy (Steps 2-5) =="
PRIVATE_EVENT_ID=$(rpc "$OWNER_JWT" "create_personal_event" "{\"p_title\":\"SECRET-MARKER-therapy\",\"p_starts_at\":\"2026-09-20T09:00:00+00:00\",\"p_ends_at\":\"2026-09-20T10:00:00+00:00\",\"p_timezone\":\"Europe/Kyiv\",\"p_description\":\"SECRET-MARKER-notes\",\"p_visibility\":\"private\",\"p_family_id\":\"$FAMILY_ID\"}" | jq -r '.')
check "owner created a private, family-linked event" "$([ -n "$PRIVATE_EVENT_ID" ] && [ "$PRIVATE_EVENT_ID" != "null" ] && echo 1 || echo 0)"

OWNER_SEES_TITLE=$(rest_get "$OWNER_JWT" "events?id=eq.$PRIVATE_EVENT_ID&select=title" | jq -r '.[0].title')
check "the owner sees the full (secret-marker) title via the base table" "$([ "$OWNER_SEES_TITLE" = "SECRET-MARKER-therapy" ] && echo 1 || echo 0)"

SPOUSE_SCHEDULE=$(rest_get "$SPOUSE_JWT" "family_schedule?id=eq.$PRIVATE_EVENT_ID&select=title,description,starts_at")
check "the spouse sees a Busy block (title/description null) via family_schedule" "$(echo "$SPOUSE_SCHEDULE" | jq -e '.[0].title == null and .[0].description == null and .[0].starts_at != null' >/dev/null 2>&1 && echo 1 || echo 0)"
check "no secret-marker text reaches the spouse through family_schedule" "$(echo "$SPOUSE_SCHEDULE" | grep -qi 'SECRET-MARKER' && echo 0 || echo 1)"

OUTSIDER_SCHEDULE=$(rest_get "$OUTSIDER_JWT" "family_schedule?id=eq.$PRIVATE_EVENT_ID&select=id")
check "an outsider (not in this family) sees nothing for this event, not even a Busy block" "$([ "$OUTSIDER_SCHEDULE" = "[]" ] && echo 1 || echo 0)"

echo "== Child event with drop-off/pick-up responsibilities (Steps 6-7) =="
SWIM_EVENT_ID=$(rpc "$OWNER_JWT" "create_child_event" "{\"p_family_id\":\"$FAMILY_ID\",\"p_child_member_id\":\"$CHILD_MEMBER_ID\",\"p_title\":\"Swimming\",\"p_starts_at\":\"2026-09-21T17:00:00+00:00\",\"p_ends_at\":\"2026-09-21T18:00:00+00:00\",\"p_timezone\":\"Europe/Kyiv\",\"p_drop_off_assignee_member_id\":\"$OWNER_MEMBER_ID\",\"p_pick_up_assignee_member_id\":\"$SPOUSE_MEMBER_ID\"}" | jq -r '.')
check "owner created a child (swimming) event with drop-off/pick-up assigned to different adults" "$([ -n "$SWIM_EVENT_ID" ] && [ "$SWIM_EVENT_ID" != "null" ] && echo 1 || echo 0)"

RESPONSIBILITIES=$(rest_get "$OWNER_JWT" "responsibilities?event_id=eq.$SWIM_EVENT_ID&select=id,type,status,assignee_member_id&order=type.asc")
check "exactly two responsibility rows exist for the swim event (drop_off, pick_up)" "$([ "$(echo "$RESPONSIBILITIES" | jq 'length')" = "2" ] && echo 1 || echo 0)"
check "self-assigned drop_off (owner->owner) is immediately accepted" "$(echo "$RESPONSIBILITIES" | jq -e '.[] | select(.type=="drop_off") | .status=="accepted"' >/dev/null 2>&1 && echo 1 || echo 0)"
PICKUP_ID=$(echo "$RESPONSIBILITIES" | jq -r '.[] | select(.type=="pick_up") | .id')
DROPOFF_ID=$(echo "$RESPONSIBILITIES" | jq -r '.[] | select(.type=="drop_off") | .id')
check "pick_up assigned to the spouse (not the creator) starts pending_acceptance" "$(echo "$RESPONSIBILITIES" | jq -e '.[] | select(.type=="pick_up") | .status=="pending_acceptance"' >/dev/null 2>&1 && echo 1 || echo 0)"

echo "== Accept one assignment (Step 8) =="
rpc "$SPOUSE_JWT" "accept_event_responsibility" "{\"p_responsibility_id\":\"$PICKUP_ID\"}" >/dev/null
ACCEPTED_STATUS=$(rest_get "$OWNER_JWT" "responsibilities?id=eq.$PICKUP_ID&select=status" | jq -r '.[0].status')
check "the spouse accepting moves pick_up to accepted" "$([ "$ACCEPTED_STATUS" = "accepted" ] && echo 1 || echo 0)"

echo "== Decline another, then take it (Steps 9-10) =="
PIANO_EVENT_ID=$(rpc "$OWNER_JWT" "create_child_event" "{\"p_family_id\":\"$FAMILY_ID\",\"p_child_member_id\":\"$CHILD_MEMBER_ID\",\"p_title\":\"Piano lesson\",\"p_starts_at\":\"2026-09-22T16:00:00+00:00\",\"p_ends_at\":\"2026-09-22T17:00:00+00:00\",\"p_timezone\":\"Europe/Kyiv\",\"p_pick_up_assignee_member_id\":\"$SPOUSE_MEMBER_ID\"}" | jq -r '.')
PIANO_PICKUP_ID=$(rest_get "$OWNER_JWT" "responsibilities?event_id=eq.$PIANO_EVENT_ID&type=eq.pick_up&select=id" | jq -r '.[0].id')

rpc "$SPOUSE_JWT" "decline_event_responsibility" "{\"p_responsibility_id\":\"$PIANO_PICKUP_ID\"}" >/dev/null
DECLINED_STATUS=$(rest_get "$OWNER_JWT" "responsibilities?id=eq.$PIANO_PICKUP_ID&select=status,assignee_member_id" | jq -r '.[0].status')
check "the spouse declining resolves pick_up back to unassigned" "$([ "$DECLINED_STATUS" = "unassigned" ] && echo 1 || echo 0)"

rpc "$OWNER_JWT" "take_event_responsibility" "{\"p_responsibility_id\":\"$PIANO_PICKUP_ID\"}" >/dev/null
TAKEN_STATUS=$(rest_get "$OWNER_JWT" "responsibilities?id=eq.$PIANO_PICKUP_ID&select=status,assignee_member_id" | jq -r '.[0].status')
check "the owner taking the declined/unassigned responsibility is immediate acceptance" "$([ "$TAKEN_STATUS" = "accepted" ] && echo 1 || echo 0)"

echo "== Deterministic conflict detection (Steps 11-12) =="
rpc "$SPOUSE_JWT" "create_personal_event" "{\"p_title\":\"SECRET-MARKER-dentist\",\"p_starts_at\":\"2026-09-23T17:00:00+00:00\",\"p_ends_at\":\"2026-09-23T18:00:00+00:00\",\"p_timezone\":\"Europe/Kyiv\"}" >/dev/null

CONFLICT_EVENT_ID=$(rpc "$OWNER_JWT" "create_child_event" "{\"p_family_id\":\"$FAMILY_ID\",\"p_child_member_id\":\"$CHILD_MEMBER_ID\",\"p_title\":\"Overlapping event\",\"p_starts_at\":\"2026-09-23T17:00:00+00:00\",\"p_ends_at\":\"2026-09-23T18:00:00+00:00\",\"p_timezone\":\"Europe/Kyiv\",\"p_pick_up_assignee_member_id\":\"$SPOUSE_MEMBER_ID\"}" | jq -r '.')
CONFLICT_PICKUP_ID=$(rest_get "$OWNER_JWT" "responsibilities?event_id=eq.$CONFLICT_EVENT_ID&type=eq.pick_up&select=id" | jq -r '.[0].id')
rpc "$SPOUSE_JWT" "accept_event_responsibility" "{\"p_responsibility_id\":\"$CONFLICT_PICKUP_ID\"}" >/dev/null

CONFLICT_RESULT=$(rpc "$OWNER_JWT" "has_member_schedule_conflict" "{\"p_member_id\":\"$SPOUSE_MEMBER_ID\",\"p_starts_at\":\"2026-09-23T17:00:00+00:00\",\"p_ends_at\":\"2026-09-23T18:00:00+00:00\",\"p_exclude_responsibility_id\":\"$CONFLICT_PICKUP_ID\"}")
check "a real deterministic conflict (spouse's own overlapping private event) is detected" "$([ "$CONFLICT_RESULT" = "true" ] && echo 1 || echo 0)"
check "the conflict RPC's response body is exactly a bare boolean - no event id, title, or any other field" "$(echo "$CONFLICT_RESULT" | grep -qi 'SECRET-MARKER\|title\|description' && echo 0 || echo 1)"

echo "== Notification outbox: expected records + no duplication on replay (Steps 13-14) =="
REQUESTED_COUNT=$(psql_query "select count(*) from notifications.outbox where family_id = '$FAMILY_ID' and event_type = 'event_responsibility.assignment_requested.v1';")
check "'requested' outbox rows exist for pick_up assignments made to a different adult" "$([ "$REQUESTED_COUNT" -ge 3 ] && echo 1 || echo 0)"
ACCEPTED_COUNT=$(psql_query "select count(*) from notifications.outbox where family_id = '$FAMILY_ID' and event_type = 'event_responsibility.assignment_accepted.v1';")
check "'accepted' outbox rows exist for the accept actions above" "$([ "$ACCEPTED_COUNT" -ge 2 ] && echo 1 || echo 0)"
DECLINED_COUNT=$(psql_query "select count(*) from notifications.outbox where family_id = '$FAMILY_ID' and event_type = 'event_responsibility.assignment_declined.v1';")
check "a 'declined' outbox row exists for the piano pick_up decline" "$([ "$DECLINED_COUNT" = "1" ] && echo 1 || echo 0)"
SELF_ASSIGN_COUNT=$(psql_query "select count(*) from notifications.outbox where family_id = '$FAMILY_ID' and responsibility_id = '$DROPOFF_ID';")
check "the owner's self-assigned drop_off never enqueued a 'requested' notification (self-notification suppression)" "$([ "$SELF_ASSIGN_COUNT" = "0" ] && echo 1 || echo 0)"

DUPLICATE_KEYS=$(psql_query "select count(*) from (select idempotency_key, count(*) c from notifications.outbox where family_id = '$FAMILY_ID' group by idempotency_key having count(*) > 1) d;")
check "no idempotency_key is duplicated across this run's outbox rows" "$([ "$DUPLICATE_KEYS" = "0" ] && echo 1 || echo 0)"

# A stale-recipient replay attempt (re-accepting an already-resolved
# responsibility) must fail the state machine, not silently succeed and
# enqueue a second logical notification.
rpc "$SPOUSE_JWT" "accept_event_responsibility" "{\"p_responsibility_id\":\"$PICKUP_ID\"}" >/dev/null
refresh_code
check "re-accepting an already-accepted responsibility is rejected, not silently replayed (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"
REPLAY_ACCEPTED_COUNT=$(psql_query "select count(*) from notifications.outbox where family_id = '$FAMILY_ID' and event_id = '$SWIM_EVENT_ID' and event_type = 'event_responsibility.assignment_accepted.v1';")
check "the rejected replay did not enqueue a second 'accepted' notification for the same responsibility" "$([ "$REPLAY_ACCEPTED_COUNT" = "1" ] && echo 1 || echo 0)"

echo "== Authorization boundaries =="
rpc "$OUTSIDER_JWT" "take_event_responsibility" "{\"p_responsibility_id\":\"$PIANO_PICKUP_ID\"}" >/dev/null
refresh_code
check "an outsider cannot act on a responsibility in a family they don't belong to (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"

rpc "$OUTSIDER_JWT" "create_family_event" "{\"p_family_id\":\"$FAMILY_ID\",\"p_title\":\"x\",\"p_starts_at\":\"2026-09-24T10:00:00+00:00\",\"p_ends_at\":\"2026-09-24T11:00:00+00:00\",\"p_timezone\":\"UTC\"}" >/dev/null
refresh_code
check "an outsider cannot create a family event for a family they don't belong to (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"

echo
echo "=================================================="
echo "Real calendar backend integration: $PASS passed, $FAIL failed"
echo "=================================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
