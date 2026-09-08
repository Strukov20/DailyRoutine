---
title: Family calendar
status: current
updated: 2026-09-08
sources:
  - ../../../docs/ARCHITECTURE.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/DECISIONS.md
  - ../../../docs/TEST_STRATEGY.md
  - ../../raw/sessions/2026-09-07-phase7-family-calendar.md
  - ../../raw/sessions/2026-09-08-phase7-followup-audit.md
  - ../../raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md
tags: [engineering, calendar, events, responsibilities, phase7]
---

## Status: implemented (Phase 7)

The MVP Day Calendar — personal/family/child events, drop-off/pick-up responsibilities as
records separate from the event they attach to, the responsibility assignment state machine,
Busy-block privacy for private family-linked events, and deterministic privacy-safe conflict
detection. Explicit non-goals: Week/Month views, recurring events, scheduled reminders,
Google/Apple Calendar sync, travel-time/maps, *automatic* conflict resolution, drag-and-drop,
attachments, event ownership transfer, and all-day/date-only events — see
[roadmap](../product/roadmap.md).

## Evolved the existing Phase 2 schema, did not replace it

`events`/`event_participants`/`responsibilities` already existed (Phase 2: schema, RLS,
integrity constraints) but had no RPC layer and no UI. Audited before writing anything new,
per this repository's own instruction not to create parallel tables without first proving the
existing model can't support the requirements — it could. Only additions: `events.deleted_at`
(soft cancel, mirroring `tasks.deleted_at`) and a `responsibility_assignments` audit table.
`responsibilities.status`'s existing vocabulary (`unassigned | pending_acceptance | accepted
| declined | done`, already matching `tasks.assignment_status`) was kept as-is rather than
renamed to match the brief's own shorter prose.

## Audit finding: the same direct-grant gap Phase 4 found for `tasks`

`events`/`event_participants`/`responsibilities` granted raw INSERT/UPDATE/DELETE to
`authenticated` since Phase 2. `responsibilities_owner_manages` in particular let the event
owner `UPDATE` a responsibility's `status`/`assignee_member_id` directly via a plain PATCH —
bypassing the accept/decline/take state machine and its audit trail entirely, the exact shape
of gap [security-model](security-model.md) already documents for `tasks`. Closed the same
way: the three grants revoked, every mutation replaced by a narrowly scoped `SECURITY
DEFINER` RPC. `SELECT` stays direct/RLS-governed.

## Responsibility assignment: a second audit table, not a shared one

`responsibility_assignments` mirrors `task_assignments` structurally (append-only,
`assigned_to_member_id`/`assigned_by_member_id`/`action`, the same self-assign-is-immediate-
acceptance shortcut, the same `FOR UPDATE`-row-locking concurrency discipline) but is a
**separate table** — reusing `task_assignments` was considered and rejected, since it would
make "every assignment this family member has ever had" ambiguous between two unrelated
domain concepts sharing one table. Unlike `task_assignments`, its rows cascade-delete with
their responsibility — see [Events and responsibilities](../domain/events-and-responsibilities.md)
and `remove_event_responsibility` for why that's safe here specifically (an active pending/
accepted commitment can't be removed at all without unassigning first).

## Conflict detection: one function, three sources, a boolean only

`has_member_schedule_conflict(member_id, starts_at, ends_at, exclude_responsibility_id)` —
read-only, `SECURITY DEFINER`, checks the member's own events, a timed task assignment, and
another accepted responsibility for a half-open (`[starts_at, ends_at)`) time overlap, and
returns **only a boolean** — never which item it conflicted with or any of its content. A
view was considered and rejected: it would need to either leak an identifying id (defeating
the privacy goal) or be too sanitized to be useful. The client renders a fixed, generic
warning ("{name} is busy at this time") regardless of which of the three sources triggered
it; conflicts never block a save, only warn. **Extended in Phase 8** (via `CREATE OR REPLACE`,
signature unchanged) to also check a member's own recurring task occurrences and one-off timed
personal tasks — see [recurring-tasks-and-reminders](recurring-tasks-and-reminders.md). See
[security-model](security-model.md), Mechanism 4b.

## Two sanitized read views, combined client-side

`family_schedule` (evolved this phase: excludes soft-deleted events, exposes a
`participant_member_id`) and `family_responsibilities` (new — drop-off/pick-up, joined with
its parent event's always-visible fields, since a responsibility can only exist on a
`visibility = 'family'` event in the first place, so no title/description sanitization is
ever needed there). The Calendar screen combines both into one chronological agenda rather
than either view trying to be everything — see "Avoid showing the same responsibility twice"
in the original brief, satisfied by construction (family tasks, events, and responsibilities
are three disjoint queries, never overlapping rows).

## Timezone handling

`events.starts_at`/`ends_at` are `timestamptz` — an unambiguous UTC instant by construction,
never an ambiguous local timestamp. `timezone` (IANA) is stored alongside purely for
rendering and for computing local-day query boundaries client-side.
`src/domain/calendar/dateUtils.ts`'s `localDayBoundsUtc` goes through the local `Date`
constructor (DST-correct) rather than a fixed UTC offset — the same "local-constructor-only"
discipline [personal-planning](../domain/personal-planning.md)'s `dateUtils.ts` established in
Phase 4 for a genuinely different problem (a deliberately ambiguous date-only string there,
vs. a real instant here). The MVP Day Calendar has no all-day/date-only event concept this
phase — date + start + end are always required, deferred rather than modeled ambiguously.

## Calendar screen doubles as Family Today

No separate "Family Today" screen — the Calendar screen's own Personal/Family mode toggle,
Family mode defaulted to today, *is* Family Today. Both the brief's "Calendar Day view" and
"Family Today" worked examples reduce to the same underlying data (a day's events and
responsibilities, optionally filtered by member); building two near-duplicate screens for
that was judged not worth the maintenance cost this phase.

## Push notifications extend, not duplicate, the Phase 6 outbox

Four new event types (`event_responsibility.assignment_{requested,accepted,declined,taken}.v1`)
reuse `notifications.outbox` — which gained nullable `event_id`/`responsibility_id` columns
alongside the existing `task_id`/`task_assignment_id` ones, with a `CHECK` enforcing exactly
one source per row — and a second trigger
(`enqueue_event_responsibility_notification`, mirroring the task one exactly) on
`responsibility_assignments`. Same guarantees as Phase 6: server-derived recipient, no
self-notification, ids-only payload (`eventId`, not task/event content). See [Push
notifications](push-notifications.md).

## Testing

- **pgTAP** (`120_family_calendar_test.sql`, 88 assertions) — creation authorization, the
  event ≠ responsibility rule (renaming an event / moving its time leaves responsibilities
  untouched; `due_at` derives and never drifts), the full responsibility state machine,
  Busy-block privacy (secret-marker sweep), conflict-detection interval semantics,
  member-removal resolution, and the notification outbox extension.
- **`scripts/e2e-calendar.sh`** (`npm run e2e:calendar`, 28 checks — 27 original + 1 added in
  the Phase 7 follow-up audit for the `taken` notification event type) — real `auth.users`
  accounts, real RPCs, a real deterministic conflict, notification outbox verification for
  all four `event_responsibility.*` event types (including that a rejected stale-state replay
  never enqueues a duplicate), and authorization boundaries. Confirmed repeatable twice
  consecutively without a DB reset, zero residue both times.
- **Jest** (`src/domain/calendar/{dateUtils,schemas,mappers}.test.ts`) — day-boundary/
  interval-overlap arithmetic and the event editor's kind-specific validation rules.
  `src/components/calendar/{ResponsibilityRow,EventEditorForm}.test.tsx` and
  `src/components/calendar/CalendarScreen.test.tsx` (Phase 7 follow-up — mandatory per a
  later, more detailed brief, overriding the original phase's deferral) cover the Day
  Calendar's Personal/Family modes, member filters, chronological rendering, Busy-block
  non-navigability, and conflict-warning content; the responsibility action buttons; and the
  event editor's validation/submission logic (scoped around the same RNTL `<Menu>`
  limitation Phase 5 documented — opened-menu content still isn't tested, trigger buttons and
  submitted payloads are). `CalendarScreen.test.tsx` deliberately lives in
  `src/components/calendar/`, not co-located with `app/(app)/calendar.tsx` — see
  [testing-strategy](testing-strategy.md) for why a test file under `app/` broke the iOS
  bundle export.
- **Not covered**: Maestro E2E flows (deferred given the established Maestro non-determinism
  and this feature's own scope, rather than risk a rushed/flaky addition) — unchanged from the
  original phase. See [testing-strategy](testing-strategy.md).

## A real bug found while building the backend integration script

`scripts/e2e-backend.sh`'s/`e2e-notifications.sh`'s `admin_create_user` helper appended to a
`CREATED_USER_IDS` array *inside* the function, but call sites invoked it via command
substitution (`OWNER_ID=$(admin_create_user ...)`) — which runs in a subshell, discarding the
array mutation before it ever reached `cleanup()`. `e2e-notifications.sh` had been silently
leaking its test `auth.users` accounts since Phase 6 (12 accumulated, found and purged while
building this phase's own script). Fixed in both scripts by appending at the call site
instead. Full write-up: [DECISIONS.md, "Phase 7"](../../../docs/DECISIONS.md).

## Phase 7 follow-up: audit against a more detailed brief

A later, more detailed Phase 7 brief arrived after this feature was already built and merged
onto `develop`. Audited the existing implementation against it (per that brief's own
instruction) rather than rebuilding, and closed four real gaps: three trigger functions in the
migration were missing an explicit `revoke` (not exploitable — the Phase 6.1 anon-EXECUTE
guard already exempts trigger functions — but inconsistent with Phase 6's own established
defense-in-depth convention); the `declined`/`taken` notification event types had no direct
pgTAP/e2e assertion; the Day Calendar screen was missing the offline banner and pull-to-refresh
every comparable screen already has; and the mandatory Jest UI coverage above was added. Full
write-up: [DECISIONS.md, "Phase 7 follow-up"](../../../docs/DECISIONS.md).

## See also

- [Events and responsibilities](../domain/events-and-responsibilities.md) — the domain rule
  this implements
- [Tasks and assignments](../domain/tasks-and-assignments.md) — the structurally similar but
  separate task-assignment state machine this one mirrors
- [Security model](security-model.md) — Mechanisms 4/4a/4b
- [Data model](data-model.md) — the schema
- [Push notifications](push-notifications.md) — the outbox this phase extends
- [Recurring tasks and reminders](recurring-tasks-and-reminders.md) — the Phase 8 extension to
  `has_member_schedule_conflict`
- [Testing strategy](testing-strategy.md) — what's covered, what's deferred
- [Roadmap](../product/roadmap.md) — what's explicitly out of scope
