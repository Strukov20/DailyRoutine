---
title: Roadmap (V2/V3)
status: current
updated: 2026-09-08
sources:
  - ../../../docs/ROADMAP.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
  - ../../raw/sessions/2026-09-06-phase6-push-notifications.md
  - ../../raw/sessions/2026-09-07-phase7-family-calendar.md
  - ../../raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md
tags: [product, roadmap, v2, v3, phase8]
---

## Confirmed

**MVP-scope, delivered in Phase 8 — recurrence and reminders.** Both were in
[MVP definition](mvp-definition.md)'s in-scope list, not deferred to V2, and are now built for
personal tasks: bounded materialized occurrences (`task_occurrences`, never a rewrite of the
same row's date on completion) and a device-local `expo-notifications` reminder schedule
(never routed through Phase 6's server push outbox). Full design:
[Recurring tasks and reminders](../engineering/recurring-tasks-and-reminders.md). Explicit
non-goals kept out of Phase 8: shared/family task recurrence, and any recurrence/reminder
support for calendar events (see the Calendar-scope line below).

**Push notification scope not covered by Phase 6/7/8**: recurring-task/completion/restoration
notifications through the server outbox, digests/quiet hours, AI-driven content, email/SMS, an
in-app notification inbox, general event-content-change or child-profile notifications,
ownership-transfer notifications, and direct APNs/FCM — all deliberately deferred, not
forgotten. (Task *reminder* delivery is covered — as a device-local schedule, not this outbox —
see the line above.) See [Push notifications](../engineering/push-notifications.md), [Family
calendar](../engineering/family-calendar.md), and `docs/ROADMAP.md` for the full list.

**Calendar scope not covered by Phase 7 (or Phase 8)**: Week/Month views, recurring **events**
(Phase 8 added recurrence to personal tasks only), reminder delivery/snooze **for events**
(Phase 8's model is task-scoped only), Google/Apple Calendar sync, travel-time/maps,
*automatic* conflict resolution (deterministic detection only — see
[Family calendar](../engineering/family-calendar.md), extended in Phase 8 to also check a
member's recurring occurrences), AI planning, drag-and-drop editing, attachments, event
ownership transfer, a full offline write queue, and all-day/date-only events.

**Also still open**: family ownership transfer / an owner leaving their own family has no RPC
(`remove_family_member` unconditionally refuses to remove the `role = 'owner'` row) — see
[Family Spaces](../domain/family-spaces.md).

**V2 (not implemented, architecturally anticipated):** Google/Apple Calendar integration,
Week/Month calendar views, subtasks, attachments, shared shopping lists,
widgets, comments, advanced offline sync, statistics. **Conflict *detection* is implemented as
of Phase 7** — see [Family calendar](../engineering/family-calendar.md); conflict
*resolution* remains V2. Each remaining item has a specific anticipated schema
seam noted in [`docs/ROADMAP.md`](../../../docs/ROADMAP.md) (e.g. subtasks →
`tasks.parent_task_id`, not yet added).

**V3 (not implemented, architecturally anticipated):** natural-language task creation, "Plan
My Day," AI scheduling, automatic rescheduling **with user confirmation** (explicit brief
requirement — AI must never silently rewrite a schedule), family conflict resolution, AI
family planning. The normalized `events`/`responsibilities`/`tasks` split (see
[events-and-responsibilities](../domain/events-and-responsibilities.md)) exists partly _for_
V3 — structured data an AI planner can query, not text it has to parse.

## Offline behavior: current vs. V2

**Current (MVP-era) scope — implemented in Phase 4:** TanStack Query's `onlineManager` wired
to real connectivity (`@react-native-community/netinfo`, `src/lib/query/onlineManager.ts` —
the official React Native integration recipe) so queries pause instead of retrying against a
dead network and refetch automatically on reconnect; a visible offline banner
(`src/components/ui/OfflineBanner.tsx`) on Inbox/Today/Tomorrow; optimistic updates only for
task completion, which has a trivially safe rollback (see
[personal-planning](../domain/personal-planning.md)). Cached reads of last-loaded data are
TanStack Query's default in-memory behavior, unchanged. **Not** full offline-first sync — no
`persistQueryClient`/AsyncStorage persistence of the query cache exists yet, so cached data
does not survive an app restart; `docs/ARCHITECTURE.md` is explicit about this boundary and
the codebase must not claim otherwise.

**V2 conflict-resolution design (not yet built)**: monotonic `updated_at` (+ possibly a
`version` column) per row; last-write-wins as the default _except_ where it's actively wrong
(e.g. concurrent task completion must be idempotent, not last-write-wins); Accept/Decline is
an audit-logged event, not a mergeable field. Full detail in `docs/ROADMAP.md`.

## Unresolved

None recorded yet beyond what's already flagged inline in `docs/ROADMAP.md` (e.g. exact
shopping-list schema shape is explicitly "decide at design time, not now").

## See also

- [MVP definition](mvp-definition.md)
- [Family calendar](../engineering/family-calendar.md) — what Phase 7 built and what's still
  deferred
- [Recurring tasks and reminders](../engineering/recurring-tasks-and-reminders.md) — what
  Phase 8 built and what's still deferred
