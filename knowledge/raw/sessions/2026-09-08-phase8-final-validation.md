# Phase 8 final validation pass: real notification evidence, UX audit, a real bug fix

**Date:** 2026-09-08
**Branch:** `feature/recurring-tasks-reminders` (same branch as the main Phase 8 session).

## Context

A follow-up brief requested a corrected Phase 8 final report specifically addressing what the
prior session left unresolved: real on-device notification evidence without depending on the
broken `<Menu>`, an audit of the "This occurrence / Entire series" UX, a docs/MVP_SCOPE.md
correction, new regression tests, and a full re-verification.

## Native notification verification, without the Menu

Rather than accept the `<Menu>` limitation as a hard stop, added `app/dev-diagnostics.tsx` — a
`__DEV__`-only screen (absent from any production build; the whole component returns `null`
when `__DEV__` is false; registered in `app/_layout.tsx` only inside an `if (__DEV__)` guard;
reachable only via a direct deep link, `familyflow://dev-diagnostics`, never through normal
in-app navigation) with three buttons, each calling a real production function directly:
`requestNotificationPermission()`, `reconcileReminders()` (fed real data from
`listAllPendingReminders`/`listAllScheduledOccurrences`, the same service functions the real app
hooks call), and `expoLocalScheduler.listScheduled()`. The screen displays only ids/keys/fire
times — never a reminder's task title.

First tried avoiding even this by connecting directly to the app's Hermes/Metro CDP debugger
(`ws://localhost:8081/inspector/debug?...`) to `Runtime.evaluate` in the live app context with
zero code changes — Metro's inspector proxy accepted the connection (after adding an `Origin`/
`User-Agent` header to get past an initial 401) but then closed it immediately (code 1006) with
no response to any CDP command, for reasons not further diagnosed given time budget. Pivoted to
the dev-diagnostics screen instead, which the task's own brief explicitly sanctioned
("a development-only diagnostic log or existing production scheduler inspection is
acceptable").

Created two real test users/tasks/reminders directly via RPC (`create_personal_task`,
`create_task_reminder`) against the local Supabase stack, with `start_time` a few minutes in
the future, and drove the rest through the dev-diagnostics screen + Maestro (for the one real
system-alert tap it can reliably drive) + `xcrun simctl`:

1. Tapped "Request notification permission" → the real iOS system dialog appeared
   ("FamilyFlow Would Like to Send You Notifications") → tapped "Allow" via Maestro (this one
   *did* work reliably — permission alerts are a specially-supported XCUITest cross-process
   interaction, unlike ordinary system UI) → `getNotificationPermissionStatus()` confirmed
   `undetermined` → `granted`.
2. Tapped "Run reconcileReminders() now" → the real production algorithm scheduled exactly one
   native request with key `<profileId>:<taskId>:series:<reminderId>` and
   `fireDate: 2026-09-08T20:02:00.000Z` (23:02 local, Europe/Kyiv) — matching the task's own
   `start_time` exactly, computed independently by the real code from real database rows.
3. Waited for the fire time, then swiped down on the *locked* screen: a real system
   notification was visible — `FamilyFlow / Task reminder / 1m ago` — the generic body (not the
   real task title "Native verification reminder 2"), directly confirming the
   `reminder_titles_enabled`-default-off privacy behavior in a real delivered notification, not
   just a Jest assertion. Screenshot evidence saved.
4. A second reminder, scheduled and observed the same way, independently reproduced the same
   result. In both cases `listScheduled()` returned zero requests immediately after the fire
   time — the real OS clearing a fired one-shot trigger, additional confirmation of genuine
   delivery beyond the lock-screen screenshot.
5. Created a third reminder with a far-future fire time specifically to test reschedule/delete
   without racing a real fire: confirmed `generate=1` via reconciliation; called
   `schedule_personal_task` (the real reschedule RPC) to move its time; re-ran reconciliation —
   result `cancelled=1 scheduled=1`, same key, new fire time exactly matching the update. Called
   `delete_task_reminder`; re-ran reconciliation — `listScheduled()` returned to zero for that
   key.
6. Confirmed, both times reconciliation ran with the two already-fired reminders still in the
   input set, that they were correctly and permanently `skipped ... (past)`, never
   re-scheduled — the deterministic idempotent behavior working against real data.
7. Confirmed local scheduling required no `ExpoPushToken`, no EAS project, and no
   `Device.isDevice` gate: the existing "Enable push notifications" button
   (`registerForPushNotifications`, Phase 6) correctly threw `unsupported` on this same
   simulator in the same session, on a code path with nothing in common with the local-reminder
   functions that succeeded.

**Tap-to-navigate, and the Snooze/Done notification actions, remained unverified** — tried a
plain-text Maestro selector against the lock-screen notification (failed: "element not found"),
a point-coordinate tap on the visible banner (completed with no observable effect), and a swipe
to open Notification Center from both the lock screen and the Home Screen (the gesture never
visibly opened it). This reads as a structural limitation, not a repeat of the `<Menu>` issue:
Maestro's `appId`-scoped iOS automation can reliably drive exactly one piece of cross-process
system UI — the permission alert (which worked, see step 1) — not ordinary lock-screen/
Notification-Center content. Not reported as observed. Covered instead by
`useReminderNotificationActions.test.tsx`'s fake-response suite (the real handler function) and
`140_recurring_tasks_reminders_test.sql`'s DB-level idempotency assertions.

Test fixtures (both users, their tasks/reminders) deleted afterward via
`docker exec supabase_db_familyflow psql`.

## Occurrence-vs-series UX audit

Read `today.tsx`/`tomorrow.tsx`/`TaskActionMenu.tsx`/`TaskEditorForm.tsx` end to end. Found the
implementation already correct: complete/restore/reschedule/skip always target
`task.occurrenceId` directly; editing content always routes to `task.seriesTaskId ?? task.id`
(the series' own row), with `tasks:recurrence.seriesNotice`'s HelperText already stating
"Editing here changes every future occurrence." There is no interactive scope-choice dialog
anywhere, because none is needed — each action already implies its own scope by construction.
The one real finding: `tasks:recurrence.seriesActionThisOccurrence`/`seriesActionEntireSeries`
i18n keys existed in both `en`/`uk` locale files with zero references anywhere in the codebase
(confirmed via a full-repo grep) — dead scaffolding from some earlier design that was never
wired to a component. Removed from both files.

Wrote `src/components/tasks/TaskEditorForm.test.tsx` — the component had no test file at all
before this, despite being one of the largest/most complex in the codebase. Six tests: the
series notice renders for a recurring series and never for a plain task; neither
"This occurrence" nor "Entire series" ever render anywhere in the editor; the Repeat picker
never appears in edit mode (recurrence_rules has no client SELECT grant to re-populate it);
the Stop-repeating confirm dialog has exactly two actions and calls `stop_recurring_series`,
never `update_recurring_series`; cancelling it calls neither. All six pass, and — notably —
`<Dialog>` (unlike `<Menu>`) mounted and interacted correctly under Jest with no special
handling needed, confirming the Menu limitation is specific to that component's own
Portal-rendering path.

## A real bug found: Tonight could resolve later than Tomorrow

Running the full Jest suite near midnight local time (as this session happened to) surfaced a
real failure in `useReminderNotificationActions.test.tsx`'s existing
SNOOZE_TONIGHT/SNOOZE_TOMORROW test — not flakiness. `nextLocalTimeToday(20, now)` rolled a
passed 20:00 anchor forward by exactly 24h, landing "Tonight" at *tomorrow* 20:00 — later than
"Tomorrow" (a fixed tomorrow-09:00 anchor) — inverting the two options' relative ordering
exactly when tapped in the evening, the scenario "Tonight" exists for. The existing test had
simply never been run late enough in the day to hit this before.

Fixed the production fallback: `now + 1 hour` instead of the same hour 24h later (always
earlier than tomorrow's fixed 09:00 anchor, regardless of what time "now" actually is once past
20:00). Fixed the test's own non-determinism with `jest.useFakeTimers().setSystemTime(...)`,
splitting it into a midday case (anchor hasn't passed) and a dedicated late-night case (the
exact scenario that broke), so the fix has a permanent regression guard independent of when the
suite happens to run.

## docs/MVP_SCOPE.md correction

Found, while auditing scope boundaries: `docs/MVP_SCOPE.md` still listed "conflict detection"
under "V2 — explicitly out of scope," despite Phase 7 having implemented
`has_member_schedule_conflict()` two phases earlier. A real, pre-existing docs/code
contradiction unrelated to Phase 8's own work. Corrected to note detection is implemented,
resolution (automatically proposing/applying a fix) remains V2.

## New regression tests

- `src/lib/notifications/notificationService.test.ts`: 4 new tests proving
  `requestNotificationPermission`/`getNotificationPermissionStatus` never check
  `Device.isDevice` and never touch push-token infrastructure (`getExpoPushTokenAsync`,
  `supabase.rpc`) — the exact real-device distinction confirmed above, now locked in at the
  unit level too.
- `src/components/tasks/TaskEditorForm.test.tsx`: 6 new tests (see UX audit above).
- `src/lib/reminders/useReminderNotificationActions.test.tsx`: the existing Tonight/Tomorrow
  test fixed and split into 2 (see bug fix above).

Existing coverage already satisfied "reconciliation schedules the expected native request" and
"update/delete cancels it" (`reminderReconciliation.test.ts`'s "reschedules (cancel + schedule)"
and "cancels a stale scheduled notification" cases) and "Done is idempotent"
(`140_recurring_tasks_reminders_test.sql`'s "completing an already-completed occurrence is a
safe idempotent no-op") and the dedup layer both actions share
(`useReminderNotificationActions.test.tsx`'s "deduplicates: the same response+action never
triggers the mutation twice") — no new tests needed for those, to avoid redundant coverage of
already-locked-in behavior.

## Verified

`npm run verify`: lint/typecheck clean, `342/342` Jest across 43 suites (up from 331/42),
`wiki:lint` clean — confirmed stable across 3 consecutive full runs. Fresh
`supabase db reset && supabase test db`: `461/461` (unchanged — no schema change this pass).
`deno test` 11/11 (unchanged). `e2e:backend`/`e2e:notifications`/`e2e:calendar` all still green.
`e2e:recurrence` 23/23, twice consecutively, zero residue. Both `expo export` platforms succeed
with the new dev-diagnostics screen present. `expo-doctor` 21/21. Secret scan of both compiled
bundles: clean.

## Responsible agent

Claude (Sonnet 5, via Claude Code).
