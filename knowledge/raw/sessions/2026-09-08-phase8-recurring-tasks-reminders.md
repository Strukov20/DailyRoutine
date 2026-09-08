# Phase 8: Recurring Tasks, Scheduled Reminders, and Snooze

**Date:** 2026-09-08
**Branch:** `feature/recurring-tasks-reminders`.

## Context

A detailed 25-section brief ("Phase 8 — Recurring Tasks, Scheduled Reminders, and Snooze")
requested the two MVP-scope items `docs/ROADMAP.md` had long documented as "not yet built, with
a concrete plan": recurring personal tasks and reminder scheduling, plus Snooze. Core
requirement, in the brief's own words: "Create once → repeat predictably → remind reliably →
complete or snooze one occurrence." Explicit constraints: server-authoritative recurrence
(never client-only), stable occurrence identity, bounded generation (never unbounded), a
testable local-notification-scheduler abstraction separate from Phase 6's server push outbox,
notification permission requested only on a deliberate action (never at app startup), no
Android exact-alarm permission without explicit approval, deterministic reconciliation at fixed
lifecycle points (never continuous), and — because local scheduling is the core user-visible
feature — a real native rebuild with actual on-device verification, explicitly warning not to
describe a notification as observed unless it actually appeared.

## What was built

**Database** (`supabase/migrations/20260908120000_recurring_tasks_reminders.sql`, ~700+ lines):
`task_occurrences` (bounded materialized occurrences, `unique (task_id, original_date)` as the
idempotency anchor), `recurrence_rules` extended (`yearly` frequency, `count` end condition,
`stopped_at`), a full RPC surface (`create_recurring_task`, `generate_task_occurrences`,
`complete_task_occurrence`/`restore_task_occurrence`/`reschedule_task_occurrence`/
`skip_task_occurrence`, `update_recurring_series`, `stop_recurring_series`), `reminders`
converted to RPC-only writes with new `occurrence_id`/`is_snooze`/`label` columns and a
`remind_at`-xor-`offset_minutes_before` CHECK, a `snooze_task_occurrence` RPC, and
`has_member_schedule_conflict` extended to also check a member's own recurring occurrences and
one-off timed personal tasks. A small follow-up migration
(`20260908130000_reminder_notification_privacy.sql`) added
`notification_preferences.reminder_titles_enabled boolean not null default false`.
`supabase/tests/140_recurring_tasks_reminders_test.sql` (new, `plan(70)`) plus a small header/
description update to `070_reminders_notifications_locked_tables_test.sql` for the RPC-only
conversion (no behavioral change to that file's 9 assertions).

**Client**: `src/lib/recurrence/recurrenceService.ts` + `src/domain/recurrence/{types,schemas,hooks}.ts`
wrap the recurrence RPCs; `src/lib/tasks/taskService.ts`'s `listTasksForDate`/`listOverdueTasks`
extended to merge the occurrence read model (`personal_task_occurrences`) rather than
duplicating it; `TaskRow`/`TaskSectionList`/`TaskEditorForm` extended with recurring/rescheduled
indicators, a `RecurrencePicker`, a stop-repeating dialog, and a "This occurrence / Entire
series / Cancel" action choice; `ReminderEditorSection.tsx` (new) adds/removes reminder
definitions and — a real gap found and fixed mid-session — requests notification permission on
"add the first reminder" when the status is `'undetermined'`, which the original version did
not do at all (a reminder could be created and silently never fire).

**Local notification scheduler** (all new): `src/lib/reminders/localNotificationScheduler.ts`
(the `LocalScheduler` interface + `expoLocalScheduler`), `reminderReconciliation.ts`
(`reconcileReminders()`, the production diff-and-apply algorithm, deterministic key format
`` `${profileId}:${taskId}:${occurrenceId ?? 'series'}:${reminderId}` ``),
`useReminderReconciliation.ts` (calls it at fixed lifecycle points, never continuously),
`useReminderNotificationActions.ts` (Snooze/Done/Custom action handling, disambiguated from
Phase 6's `useNotificationResponseRouter` by checking for a `notificationType` field the two
payload shapes don't share — a real cross-router collision found while wiring this in). A new
"Show task titles in notifications" Switch (default off) on the Notification Settings screen.

**e2e**: `scripts/e2e-recurrence.sh` (23 checks, `npm run e2e:recurrence`), confirmed repeatable
twice consecutively with no DB reset in between.

## Real bugs found and fixed via direct testing, before/while writing pgTAP

- Weekly interval-week math: `date_trunc('week', ts)` returns a timestamp; subtracting two
  without casting to `::date` first produced an interval, invalid for integer division.
- A weekly series' first occurrence used the raw creation-date anchor even when it fell on a
  weekday not in `by_weekday` (e.g. created Tuesday, repeating Mon/Wed/Fri) — fixed by snapping
  forward day-by-day to the first matching weekday, weekly-only (daily/monthly/yearly's anchor
  is trivially valid by construction).
- None of `complete_task_occurrence`/`restore_task_occurrence`/`skip_task_occurrence`/
  `reschedule_task_occurrence` checked whether the parent series was soft-deleted
  (`tasks.deleted_at`) — fixed by joining with `t.deleted_at is null`.
- `has_member_schedule_conflict` never checked a member's own recurring occurrences or one-off
  timed personal tasks — extended via `CREATE OR REPLACE`, signature/grants unchanged.
- A real timezone-mixing bug in my own conflict-detection pgTAP test: a hardcoded
  `'... +00'::timestamptz` compared against an occurrence whose real instant was in Kyiv local
  time (the test runner's own system timezone) — fixed with a proper
  `at time zone 'Europe/Kyiv'` conversion instead of hand-computed UTC offsets.

## Real, confirmed-flaky Jest test found via full-suite reproduction (not isolation)

`ReminderEditorSection.test.tsx`'s two Menu-interaction tests passed alone but intermittently
failed at full-suite scale — reproducing, in Jest, the exact documented Phase-5 `<Menu>`
unreliability. Fixed by extracting the pure `existingReminderOffsets()` function and testing
that directly instead of driving the Menu open at all. Confirmed stable across 3 consecutive
full runs (331/331 each) afterward.

## Native verification: what was actually driven on-device

`npx expo run:ios` succeeded against a real iPhone 17 Pro (iOS 26.5) simulator. Directly, visually
confirmed: real Supabase Auth sign-in end-to-end; a task created via the app's own
`create_personal_task` RPC path correctly appearing in the real Today screen's Timed section at
the correct time; a reminder created via `create_task_reminder` correctly appearing in the real
Edit Task screen's Reminders section; `familyflow://` deep links correctly routing to both the
Notifications settings screen and a specific task's edit screen; the existing "Enable push
notifications" button correctly refusing on a simulator (`Device.isDevice` gate, Phase 6),
confirming that's a genuinely different code path from local-reminder permission
(`requestNotificationPermission()`, which has no such gate).

**Not achieved, and not claimed as observed**: granting real local-notification permission
through the app's own UI, and therefore a real delivered/tapped local notification. Blocker:
`ReminderEditorSection`'s `<Menu>` (react-native-paper) never visibly opens when driven by
Maestro on this setup. Diagnosed exhaustively rather than assumed:

1. Six tap strategies against the anchor (testID, text-with-retry, exact point coordinates,
   after dismissing an overlay, after a full relaunch, after a scroll) all reported `COMPLETED`
   in Maestro's own output; the following screenshot showed no state change every time.
2. A `maestro hierarchy` dump taken immediately after a tap showed **zero** menu content
   anywhere in the accessibility tree.
3. `ffmpeg` (installed this session specifically for this) extracted a screen recording of the
   tap frame-by-frame: the button's own pressed-state highlight fires correctly (proving the
   touch registers), with no menu content in any frame before or after — not a flash-open-close
   race, a genuine non-open.
4. A second, independent `<Menu>` on the same screen (the task editor's Category picker) showed
   the identical failure — ruling out a component-specific bug. Both anchors share exactly one
   property: they live on a screen presented via `presentation: 'modal'`.

Conclusion, recorded in `docs/DECISIONS.md`: a genuine `react-native-paper` Portal /
`react-native-screens` native-modal-presentation interaction, not an application defect —
extends the already-known Jest/react-test-renderer limitation (Phase 5) to live Maestro
interaction on a modal screen specifically. Snooze/Done action verification, tap-routing
verification, and cancellation-after-update verification are therefore not reported as
observed. Android: exports/doctor clean; no real native build/run attempted this session.

## Verified

Fresh `db reset && test db`: 461/461 (14 files, up from 391/13). `npm run verify`: 331/331 Jest
(42 suites), lint/typecheck/wiki:lint clean. `deno test`: 11/11. `e2e:backend` 32/32,
`e2e:notifications` 24/24, `e2e:calendar` 28/28 (all unchanged — no regression from Phase 8's
schema additions). `e2e:recurrence` (new) 23/23, run twice consecutively with no DB reset,
zero residue both times. Both `expo export` platforms clean. `expo-doctor` 21/21. Secret scan
of both compiled bundles: clean.

## Cleanup

The `native-verify@example.com` test user and its task/reminder rows (created directly via
RPC against the local Supabase stack for on-device verification) were deleted after testing —
confirmed via `docker exec supabase_db_familyflow psql`.

## Responsible agent

Claude (Sonnet 5, via Claude Code).
