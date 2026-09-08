#!/usr/bin/env bash
# Real multi-user backend integration flow for recurring personal tasks,
# occurrences, and reminders (Phase 8): generation, occurrence identity,
# individual lifecycle actions, series-wide update/stop, reminders, and
# cross-user rejection — all against the real RPC/RLS/trigger surface on a
# live local Postgres instance. Mirrors scripts/e2e-calendar.sh's
# established safety/cleanup discipline exactly, including the subshell
# array-append fix (see docs/DECISIONS.md, "Phase 7") — every
# admin_create_user call site below appends to CREATED_USER_IDS itself,
# never inside the function.
#
# LOCAL SUPABASE ONLY. Every URL/connection string this script uses is
# read from `supabase status` and verified to resolve to
# 127.0.0.1/localhost before a single request is sent or a single
# connection is opened.
#
# Usage: npm run e2e:recurrence
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
  echo "Could not find a running supabase_db_* container - required for direct recurrence_rules/reminders inspection." >&2
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

cleanup() {
  local exit_code=$?
  set +e
  for uid in "${CREATED_USER_IDS[@]:-}"; do
    [ -n "$uid" ] || continue
    # reminders/task_occurrences cascade automatically from tasks, but
    # deleted explicitly first anyway (belt-and-suspenders, same
    # convention as every other e2e script's cleanup). recurrence_rules
    # has zero grants for any client role — direct psql only, and must run
    # AFTER tasks are gone (tasks.recurrence_rule_id references it, no
    # cascade the other way).
    psql_query "delete from public.reminders where profile_id = '$uid';" >/dev/null
    psql_query "delete from public.task_occurrences where owner_profile_id = '$uid';" >/dev/null
    psql_query "delete from public.tasks where owner_profile_id = '$uid';" >/dev/null
    psql_query "delete from public.recurrence_rules where created_by = '$uid';" >/dev/null
    curl -sS -o /dev/null -X DELETE "$API_URL/auth/v1/admin/users/$uid" \
      -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
  done
  rm -f /tmp/_e2e_recurrence_http_code
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
  # Deliberately does NOT append to CREATED_USER_IDS here — every call site
  # below invokes this via command substitution ($(...)), which runs the
  # function in a subshell; an array mutation here would be discarded the
  # instant that subshell exits, silently never reaching cleanup() (the
  # real, previously-undiscovered bug fixed in Phase 7 — see
  # docs/DECISIONS.md). Every call site appends the returned id itself.
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
  echo -n "$resp" | tail -1 >/tmp/_e2e_recurrence_http_code
  echo "$resp" | sed '$d'
}

rest_get() {
  local token="$1" path="$2"
  local resp
  resp=$(curl -sS -w '\n%{http_code}' -X GET "$API_URL/rest/v1/$path" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $token")
  echo -n "$resp" | tail -1 >/tmp/_e2e_recurrence_http_code
  echo "$resp" | sed '$d'
}

refresh_code() {
  HTTP_CODE=$(cat /tmp/_e2e_recurrence_http_code)
}

STAMP="$(date +%s)-$$-$RANDOM"
OWNER_EMAIL="e2e-rec-owner-$STAMP@example.com"
OUTSIDER_EMAIL="e2e-rec-outsider-$STAMP@example.com"
PASSWORD="Str0ngPassw0rd!"

echo "== Creating real auth.users accounts (admin API, pre-confirmed) =="
OWNER_ID=$(admin_create_user "$OWNER_EMAIL" "$PASSWORD")
CREATED_USER_IDS+=("$OWNER_ID")
OUTSIDER_ID=$(admin_create_user "$OUTSIDER_EMAIL" "$PASSWORD")
CREATED_USER_IDS+=("$OUTSIDER_ID")

OWNER_JWT=$(sign_in "$OWNER_EMAIL" "$PASSWORD")
OUTSIDER_JWT=$(sign_in "$OUTSIDER_EMAIL" "$PASSWORD")
check "both users signed in with a real JWT" "$([ -n "$OWNER_JWT" ] && [ "$OWNER_JWT" != "null" ] && [ -n "$OUTSIDER_JWT" ] && [ "$OUTSIDER_JWT" != "null" ] && echo 1 || echo 0)"

echo "== Create a daily recurring task and expand into a bounded window (Steps 1-2) =="
TASK_ID=$(rpc "$OWNER_JWT" "create_recurring_personal_task" \
  '{"p_title":"Take vitamins","p_date":"2026-09-08","p_timezone":"Europe/Kyiv","p_frequency":"daily","p_start_time":"08:00:00"}' \
  | jq -r '.')
check "owner created a daily recurring task" "$([ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] && echo 1 || echo 0)"

OCCURRENCES=$(rest_get "$OWNER_JWT" "task_occurrences?task_id=eq.$TASK_ID&select=id,original_date,occurrence_date,status&order=original_date.asc")
OCC_COUNT=$(echo "$OCCURRENCES" | jq 'length')
check "creation eagerly generated a bounded window of occurrences (>1, <=46)" "$([ "$OCC_COUNT" -gt 1 ] && [ "$OCC_COUNT" -le 46 ] && echo 1 || echo 0)"

echo "== Stable occurrence identity + replay generation without duplicates (Steps 3-4) =="
FIRST_IDS=$(echo "$OCCURRENCES" | jq -r '[.[].id] | sort | join(",")')
rpc "$OWNER_JWT" "generate_task_occurrences" '{}' >/dev/null
OCCURRENCES_2=$(rest_get "$OWNER_JWT" "task_occurrences?task_id=eq.$TASK_ID&select=id,original_date,occurrence_date,status&order=original_date.asc")
SECOND_IDS=$(echo "$OCCURRENCES_2" | jq -r '[.[].id] | sort | join(",")')
check "occurrence ids are stable across a replayed generation call" "$([ "$FIRST_IDS" = "$SECOND_IDS" ] && echo 1 || echo 0)"
OCC_COUNT_2=$(echo "$OCCURRENCES_2" | jq 'length')
check "replaying generation never creates duplicate rows (same count)" "$([ "$OCC_COUNT" = "$OCC_COUNT_2" ] && echo 1 || echo 0)"

FIRST_OCC_ID=$(echo "$OCCURRENCES" | jq -r '.[0].id')
SECOND_OCC_ID=$(echo "$OCCURRENCES" | jq -r '.[1].id')
THIRD_OCC_ID=$(echo "$OCCURRENCES" | jq -r '.[2].id')

echo "== Complete one occurrence; the next stays open (Steps 5-6) =="
rpc "$OWNER_JWT" "complete_task_occurrence" "{\"p_occurrence_id\":\"$FIRST_OCC_ID\"}" >/dev/null
FIRST_STATUS=$(rest_get "$OWNER_JWT" "task_occurrences?id=eq.$FIRST_OCC_ID&select=status" | jq -r '.[0].status')
check "the targeted occurrence is now completed" "$([ "$FIRST_STATUS" = "completed" ] && echo 1 || echo 0)"
SECOND_STATUS=$(rest_get "$OWNER_JWT" "task_occurrences?id=eq.$SECOND_OCC_ID&select=status" | jq -r '.[0].status')
check "the next occurrence of the same series remains open (scheduled)" "$([ "$SECOND_STATUS" = "scheduled" ] && echo 1 || echo 0)"

echo "== Reschedule one occurrence (Step 7) =="
rpc "$OWNER_JWT" "reschedule_task_occurrence" "{\"p_occurrence_id\":\"$SECOND_OCC_ID\",\"p_date\":\"2026-10-20\",\"p_start_time\":\"09:30:00\"}" >/dev/null
RESCHED=$(rest_get "$OWNER_JWT" "task_occurrences?id=eq.$SECOND_OCC_ID&select=occurrence_date,original_date,rescheduled")
check "reschedule moves occurrence_date but leaves original_date untouched" "$(echo "$RESCHED" | jq -e '.[0].occurrence_date=="2026-10-20" and .[0].original_date!="2026-10-20" and .[0].rescheduled==true' >/dev/null 2>&1 && echo 1 || echo 0)"

echo "== Skip one occurrence (Step 8) =="
rpc "$OWNER_JWT" "skip_task_occurrence" "{\"p_occurrence_id\":\"$THIRD_OCC_ID\"}" >/dev/null
THIRD_STATUS=$(rest_get "$OWNER_JWT" "task_occurrences?id=eq.$THIRD_OCC_ID&select=status" | jq -r '.[0].status')
check "the skipped occurrence is now skipped" "$([ "$THIRD_STATUS" = "skipped" ] && echo 1 || echo 0)"

echo "== Update the entire future series; historical completion survives (Step 9-10) =="
rpc "$OWNER_JWT" "update_recurring_series" "{\"p_task_id\":\"$TASK_ID\",\"p_title\":\"Take vitamins (renamed)\",\"p_start_time\":\"07:00:00\"}" >/dev/null
NEW_TITLE=$(rest_get "$OWNER_JWT" "tasks?id=eq.$TASK_ID&select=title" | jq -r '.[0].title')
check "update_recurring_series renamed the series" "$([ "$NEW_TITLE" = "Take vitamins (renamed)" ] && echo 1 || echo 0)"
FIRST_STATUS_AFTER=$(rest_get "$OWNER_JWT" "task_occurrences?id=eq.$FIRST_OCC_ID&select=status" | jq -r '.[0].status')
check "the historical completion survives a series-wide update untouched" "$([ "$FIRST_STATUS_AFTER" = "completed" ] && echo 1 || echo 0)"
RESCHED_AFTER=$(rest_get "$OWNER_JWT" "task_occurrences?id=eq.$SECOND_OCC_ID&select=occurrence_date" | jq -r '.[0].occurrence_date')
check "an individually-rescheduled occurrence is never silently overwritten by a series-wide update" "$([ "$RESCHED_AFTER" = "2026-10-20" ] && echo 1 || echo 0)"
rpc "$OWNER_JWT" "generate_task_occurrences" '{}' >/dev/null
NEW_TIME_COUNT=$(rest_get "$OWNER_JWT" "task_occurrences?task_id=eq.$TASK_ID&start_time=eq.07:00:00&select=id" | jq 'length')
check "eligible future occurrences regenerate with the new start_time after a series update" "$([ "$NEW_TIME_COUNT" -gt 0 ] && echo 1 || echo 0)"

echo "== Multiple reminders (Step 11) =="
REMINDER_1=$(rpc "$OWNER_JWT" "create_task_reminder" "{\"p_task_id\":\"$TASK_ID\",\"p_offset_minutes_before\":15}" | jq -r '.')
REMINDER_2=$(rpc "$OWNER_JWT" "create_task_reminder" "{\"p_task_id\":\"$TASK_ID\",\"p_offset_minutes_before\":60}" | jq -r '.')
check "two independent reminders were created for the same task" "$([ -n "$REMINDER_1" ] && [ "$REMINDER_1" != "null" ] && [ -n "$REMINDER_2" ] && [ "$REMINDER_2" != "null" ] && [ "$REMINDER_1" != "$REMINDER_2" ] && echo 1 || echo 0)"
REMINDER_COUNT=$(rest_get "$OWNER_JWT" "reminders?task_id=eq.$TASK_ID&select=id" | jq 'length')
check "both reminders are visible to their owner" "$([ "$REMINDER_COUNT" -ge 2 ] && echo 1 || echo 0)"

echo "== Cross-user access is rejected (Step 12) =="
rpc "$OUTSIDER_JWT" "complete_task_occurrence" "{\"p_occurrence_id\":\"$THIRD_OCC_ID\"}" >/dev/null
refresh_code
check "an outsider cannot complete another user's occurrence (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"
rpc "$OUTSIDER_JWT" "reschedule_task_occurrence" "{\"p_occurrence_id\":\"$THIRD_OCC_ID\",\"p_date\":\"2026-11-01\"}" >/dev/null
refresh_code
check "an outsider cannot reschedule another user's occurrence (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"
rpc "$OUTSIDER_JWT" "create_task_reminder" "{\"p_task_id\":\"$TASK_ID\",\"p_offset_minutes_before\":5}" >/dev/null
refresh_code
check "an outsider cannot create a reminder on another user's task (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"
OUTSIDER_SEES_REMINDERS=$(rest_get "$OUTSIDER_JWT" "reminders?task_id=eq.$TASK_ID&select=id" | jq 'length')
check "an outsider cannot see the owner's reminders (RLS)" "$([ "$OUTSIDER_SEES_REMINDERS" = "0" ] && echo 1 || echo 0)"
rpc "$OUTSIDER_JWT" "update_recurring_series" "{\"p_task_id\":\"$TASK_ID\",\"p_title\":\"hacked\"}" >/dev/null
refresh_code
check "an outsider cannot update another user's recurring series (HTTP $HTTP_CODE)" "$([ "$HTTP_CODE" -ge 400 ] && echo 1 || echo 0)"

echo "== Stop the series; future schedule behavior (Steps 13-14) =="
rpc "$OWNER_JWT" "stop_recurring_series" "{\"p_task_id\":\"$TASK_ID\"}" >/dev/null
STOPPED_SCHEDULED_COUNT=$(rest_get "$OWNER_JWT" "task_occurrences?task_id=eq.$TASK_ID&status=eq.scheduled&select=id" | jq 'length')
check "stopping the series leaves no scheduled occurrences behind" "$([ "$STOPPED_SCHEDULED_COUNT" = "0" ] && echo 1 || echo 0)"
FIRST_STATUS_AFTER_STOP=$(rest_get "$OWNER_JWT" "task_occurrences?id=eq.$FIRST_OCC_ID&select=status" | jq -r '.[0].status')
check "the historical completion still survives after stopping the series" "$([ "$FIRST_STATUS_AFTER_STOP" = "completed" ] && echo 1 || echo 0)"
rpc "$OWNER_JWT" "generate_task_occurrences" '{}' >/dev/null
POST_STOP_COUNT=$(rest_get "$OWNER_JWT" "task_occurrences?task_id=eq.$TASK_ID&status=eq.scheduled&select=id" | jq 'length')
check "generation never creates a new occurrence for a stopped series" "$([ "$POST_STOP_COUNT" = "0" ] && echo 1 || echo 0)"

echo
echo "=================================================="
echo "Real recurrence backend integration: $PASS passed, $FAIL failed"
echo "=================================================="
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
  exit 1
fi
exit 0
