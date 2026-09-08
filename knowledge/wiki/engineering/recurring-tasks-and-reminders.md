---
title: Recurring tasks and reminders
status: current
updated: 2026-09-08
sources:
  - ../../../docs/ARCHITECTURE.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/DECISIONS.md
  - ../../../docs/TEST_STRATEGY.md
  - ../../raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md
  - ../../raw/sessions/2026-09-08-phase8-final-validation.md
  - ../../raw/sessions/2026-09-08-phase8-production-cleanup.md
tags: [engineering, recurrence, reminders, notifications, phase8]
---

## Status: implemented (Phase 8) and verified on-device, personal tasks only

Recurring personal tasks (Daily/Weekly/Monthly/Yearly/Custom) and local reminder scheduling —
the two items `docs/ROADMAP.md` had long listed as MVP-scope but not yet built. Shared/family
tasks and calendar events get no recurrence or reminder support this phase (explicit non-goal —
see [roadmap](../product/roadmap.md)).

## Recurrence: bounded materialized occurrences, not virtual, not unbounded

One real row per generated occurrence (`task_occurrences`), generated lazily and idempotently
by `generate_task_occurrences` into a **45-day rolling horizon** — never an unbounded
background job. Chosen over fully virtual (computed-on-read) occurrences for three reasons:
Today/Tomorrow/Calendar need to join occurrence state against a date range efficiently;
[conflict detection](family-calendar.md) needs a real, queryable row to check a timed occurrence
against; and idempotent concurrent generation is simpler as "insert with a unique constraint,
`ON CONFLICT DO NOTHING`" than as "recompute a virtual set twice and reconcile." Full rationale
and the rejected alternative: [DECISIONS.md, "Phase 8"](../../../docs/DECISIONS.md).

**Two date fields, two purposes**: `original_date` (immutable — the date this occurrence *would*
fall on per the rule; the true idempotency/concurrency anchor via `unique (task_id,
original_date)`) vs. `occurrence_date` (the *current* scheduled date, mutable via reschedule).
A `rescheduled` boolean flips true once they diverge — the client's "this occurrence was moved"
indicator.

**Monthly/yearly recurrence skips a period where the anchor day doesn't exist** (a Jan 31
monthly series has no February occurrence) rather than clamping to the period's last day —
verified directly against real Postgres before the pgTAP suite was written. **Weekly recurrence
snaps its first occurrence forward** to the first matching `by_weekday` day if the creation date
itself isn't one of the selected weekdays (daily/monthly/yearly's anchor is trivially valid by
construction, so this snap is weekly-only).

**"Edit this occurrence" is reschedule/complete/restore/skip only — never content.**
`task_occurrences` has no title/description/priority/category override columns by design; every
content field lives exclusively on the series' own `tasks` row, so a content edit is always
series-wide. This is why the UI's series-action choice only ever needs "this occurrence" vs.
"entire series" vs. cancel — there is no third, partially-implemented option.

**Read model**: `personal_task_occurrences`, a `SECURITY DEFINER` RPC (not a bare view — a view
can't call the generation RPC as a read-time side effect) unions one-off tasks (unchanged) with
recurring occurrences (generating through the requested date first). `taskService.ts`'s
`listTasksForDate`/`listOverdueTasks` read through this — Today/Tomorrow extend rather than
duplicate the pre-Phase-8 list. Occurrence actions are **non-optimistic** (invalidate-only): a
recurring task's `id` repeats across every occurrence, so an optimistic cache patch keyed by
task id risks mutating the wrong occurrence in another mounted list.

## Reminders: a device-local scheduler, deliberately separate from the Phase 6 push outbox

A reminder's content and fire time are fully known on-device in advance, so there's nothing for
a server round-trip to add except latency. Reminders schedule directly through
`expo-notifications`, behind `LocalScheduler` (`schedule`/`cancel`/`listScheduled`,
`src/lib/reminders/localNotificationScheduler.ts`) — one real implementation
(`expoLocalScheduler`), one fake used only in tests, against the *production*
`reconcileReminders()` function, never a reimplementation of it.

**Two reminder shapes**: absolute (`remind_at`, valid even for an Anytime task with no
`start_time`) or relative (`offset_minutes_before`, requires a `start_time`) — exactly one, via
`reminders_exactly_one_time`. `reminders` moved to RPC-only writes this phase (pre-emptively,
not an audit finding — see [security-model](security-model.md)).

**Identity**: `` `${profileId}:${taskId}:${occurrenceId ?? 'series'}:${reminderId}` ``, embedded
in the notification's own `data.reminderKey` at schedule time — never derived from the opaque
native notification id, which is platform-specific and not stable across restarts.

**Reconciliation runs at fixed lifecycle points, never continuously**: auth-ready,
app-foreground, and after any mutation that could change what's due. It diffs "what should be
scheduled" against `scheduler.listScheduled()` and schedules/cancels only the difference,
scoped to exactly one profile's own key prefix so it can never touch another account's
notifications on a shared device.

**Permission requested only on "add the first reminder," never at app startup** —
`ReminderEditorSection.addPreset` checks `getNotificationPermissionStatus()` and only calls
`requestNotificationPermission()` when `'undetermined'`. This closed a real gap found mid-phase:
the original version created the reminder row with no permission check at all, so a reminder
could be silently created and then never fire.

**"Show task titles in notifications" defaults off**
(`notification_preferences.reminder_titles_enabled`) — when off, the task's title/body are never
even read into the notification content object (`buildContent()` substitutes fixed generic
strings), decided at build time, not filtered at display time. See
[security-model](security-model.md), "Mechanism 4c."

**Snooze/Done act on the delivered notification itself**, via a fixed registered action set
(`task_reminder.v1` category: Done, +15/30/60 min, Tonight, Tomorrow, Custom) — Snooze
schedules one fresh one-shot local notification at a documented fixed offset/time; it never
touches the underlying reminder definition or series.

**Two independent tap-routing systems, disambiguated by payload shape.** Phase 6's
`useNotificationResponseRouter` handles server-push payloads (`{ taskId | eventId, ... }`); the
new `useReminderNotificationActions` handles local payloads
(`{ notificationType: 'task_reminder', ... }`). `resolveNotificationRoute` explicitly excludes
any payload carrying `notificationType` — a real cross-router collision found and fixed while
wiring the second router in, which would otherwise have double- or mis-handled every reminder
tap.

## A genuine `<Menu>` testability limitation — worked around with a temporary `__DEV__`-only diagnostic screen

Phase 5 already documented `react-native-paper`'s `<Menu>` as unreliable under
`react-test-renderer`. Phase 8's live Maestro-driven simulator testing reproduced the identical
failure in the real running app: six tap strategies against `ReminderEditorSection`'s "Add a
reminder" button all reported success in Maestro's own output, but a `maestro hierarchy` dump
taken immediately after showed zero menu content mounted, and a frame-by-frame extraction of a
screen recording showed the button's pressed-state highlight firing correctly (the touch *is*
registered) with no menu content in any frame. A second, independent `<Menu>` on the same screen
(the Category picker) showed the identical failure, narrowing the cause to "any `<Menu>` whose
anchor lives on a screen presented via `presentation: 'modal'`" — a `Portal`/native-modal
interaction, not a component-specific bug.

**Worked around, not left blocked**: `app/dev-diagnostics.tsx` — a `__DEV__`-only screen
(absent from any production build, reachable only via a direct deep link) that called the exact
production functions `ReminderEditorSection`'s Menu items would have called
(`requestNotificationPermission`, `reconcileReminders`, `expoLocalScheduler.listScheduled`),
skipping only the broken tap-to-open-Menu step. This let permission actually be granted (a real
OS dialog, tapped via Maestro — the one cross-process interaction XCUITest specially supports)
and real production scheduling/delivery/reschedule/cancellation to be directly observed on
device. See [DECISIONS.md, "Phase 8"](../../../docs/DECISIONS.md) for the full evidence list
(scheduled-key/fire-time proof, a lock-screen delivery screenshot, reschedule
cancel-and-reschedule, delete cancellation, past-reminder skip behavior).

**The diagnostic screen itself was temporary and has since been removed before merge** — the
file, its route registration, and every reference to it are gone from the codebase; a
production-surface cleanup pass confirmed zero trace in either `expo export` output or
`npx expo config`. The evidence above is preserved as a historical record of what was directly
observed while it existed; the production functions it called are ordinary, permanent code,
unaffected by the diagnostic's removal.

**Still not verified, for a different, structural reason**: tap-to-navigate and the Snooze/Done
notification *actions* specifically. These need interaction with iOS system UI rendered in a
separate process (SpringBoard — lock screen, notification banner, Notification Center), which
is outside Maestro's addressable automation scope for an `appId`-scoped iOS flow except for the
one specially-supported permission-alert case (which did work — see above). Not reported as
observed. Covered instead by `useReminderNotificationActions.test.tsx`'s fake-response suite
(exercising the real handler function) and DB-level idempotency assertions.

See [testing-strategy](testing-strategy.md) for the resulting test-writing conventions (test the
pure logic behind a `<Menu>` directly, never the Menu interaction itself in Jest; a `__DEV__`
diagnostic screen calling real production functions is an accepted verification method when a
UI-automation limitation blocks the normal path).

## A real bug this native verification found: Tonight could resolve later than Tomorrow

`useReminderNotificationActions.ts`'s `SNOOZE_TONIGHT` handler rolled a fixed 20:00 anchor
forward by 24h once it had passed for the day — so tapped after 20:00 local, "Tonight" resolved
to *tomorrow* 20:00, later than "Tomorrow" (a fixed tomorrow-09:00 anchor), inverting the two
options exactly when a user would reach for "Tonight" in the evening. Found because this
session's own test run happened to execute near midnight, and the existing test read real
wall-clock time with no fixed system clock. Fixed: the fallback is now `now + 1 hour` (always
earlier than tomorrow 09:00) instead of the same hour 24h later; the test now fixes system time
via `jest.useFakeTimers().setSystemTime(...)`, split into a midday case and a dedicated
late-night case covering the exact scenario that broke.

## The occurrence-vs-series UX: already correct, minus two dead i18n keys

A follow-up audit confirmed the "This occurrence / Entire series" UX is correct by construction
— there was never an interactive scope-choice dialog to begin with, because every action already
implies its own scope: complete/restore/reschedule/skip always target the occurrence directly,
editing content always routes to the series' own row (with the existing `seriesNotice`
HelperText making that explicit), and the "Stop repeating" confirm dialog has exactly two
actions (Cancel, Stop repeating). The one real finding: `seriesActionThisOccurrence`/
`seriesActionEntireSeries` i18n keys existed in both locale files with zero references anywhere
— dead scaffolding, removed. `TaskEditorForm.test.tsx` (new; the component had no test file
before this) locks in the series-notice/no-misleading-option/two-action-dialog behavior, and
incidentally confirms `<Dialog>` (unlike `<Menu>`) mounts and interacts correctly under Jest.

## Testing

`supabase/tests/140_recurring_tasks_reminders_test.sql` (70 assertions, new) plus zero
regressions in the 13 pre-existing pgTAP files (461/461 total). Jest: `reminderReconciliation.test.ts`
(15 tests, the fake-scheduler suite against production reconciliation code),
`useReminderNotificationActions.test.tsx` (15 tests after the Tonight/Tomorrow fix),
`RecurrencePicker.test.tsx` (8), `ReminderEditorSection.test.tsx` (7, Menu-free after the
flaky-test fix), `TaskEditorForm.test.tsx` (6, new), `domain/recurrence/schemas.test.ts` (20),
plus 4 new tests in `notificationService.test.ts` proving local-reminder permission is
independent of push-token/EAS/`Device.isDevice`. `scripts/e2e-recurrence.sh`
(`npm run e2e:recurrence`, 23 checks) confirmed repeatable twice consecutively with no DB reset
and zero residue.

## See also

- [Family calendar](family-calendar.md) — the conflict-detection RPC this phase extended to
  check recurring occurrences too
- [Push notifications](push-notifications.md) — the server outbox this feature deliberately
  does *not* route through
- [Security model](security-model.md) — Mechanism 4c, and the `reminders` RPC-only conversion
- [Data model](data-model.md) — `task_occurrences`/`reminders`/`recurrence_rules` schema
- [Testing strategy](testing-strategy.md) — the `<Menu>` test-writing convention
- [Roadmap](../product/roadmap.md) — what's still out of scope (event recurrence/reminders,
  shared-task recurrence)
