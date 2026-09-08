---
title: MVP definition
status: current
updated: 2026-09-08
sources:
  - ../../../docs/MVP_SCOPE.md
  - ../../../docs/PRODUCT.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
  - ../../raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md
tags: [product, mvp, phase8]
---

## Confirmed

MVP scope (full list in [`docs/MVP_SCOPE.md`](../../../docs/MVP_SCOPE.md)): auth, personal
tasks, Inbox, Today/Tomorrow, scheduling, reminders, recurring tasks, personal calendar,
Family Space creation, adult invitations, child profiles, shared family calendar, shared
tasks, task assignment + Take Task, privacy (Private/Family + sanitized Busy), child events,
separately-assigned drop-off/pickup responsibilities, Family Today.

**Success scenario** (the acceptance test for "is the MVP done"): two adults each install
the app, create accounts, one creates a family, the other joins, they add a child profile,
each maintains personal items, private events show as Busy to the other, they see a combined
Family Today, create/assign shared tasks, create a child event with separately-assigned
drop-off/pickup, changes sync across devices, reminders and assignment notifications arrive.

## Current implementation status

Eight phases in, every bullet in the MVP list above is now implemented and tested against a
real local Supabase instance: auth (Phase 2); Family Space/invitations/child profiles
(Phase 3); personal tasks/Inbox/Today/Tomorrow (Phase 4 — see
[personal-planning](../domain/personal-planning.md)); shared family tasks/assignment/Take Task
(Phase 5); shared-task push notifications (Phase 6, **not yet deployed to a real device** — see
[push-notifications](../engineering/push-notifications.md)); the family calendar, child events,
and drop-off/pickup responsibilities as separate records (Phase 7 — see
[family-calendar](../engineering/family-calendar.md)); and recurring tasks + reminder
scheduling + Snooze (Phase 8 — see
[recurring-tasks-and-reminders](../engineering/recurring-tasks-and-reminders.md), including a
real on-device local-notification-delivery verification gap that phase left unresolved). Not
part of the MVP list but worth naming: Realtime sync and Week/Month calendar views remain
unbuilt — see [roadmap](roadmap.md) for exact status.

## Explicitly deferred (not MVP)

Full list: [roadmap](roadmap.md). Everything V2/V3-tagged.

## See also

- [Product vision](product-vision.md)
- [Recurring tasks and reminders](../engineering/recurring-tasks-and-reminders.md) — Phase 8
- [Development workflow](../engineering/development-workflow.md) — recommended next phase
