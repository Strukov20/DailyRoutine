---
title: MVP definition
status: current
updated: 2026-09-03
sources:
  - ../../../docs/MVP_SCOPE.md
  - ../../../docs/PRODUCT.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
tags: [product, mvp]
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

Four phases in: auth (Phase 2), Family Space/invitations/child profiles (Phase 3), and now
personal tasks/Inbox/Today/Tomorrow (Phase 4 — see
[personal-planning](../domain/personal-planning.md)) are all implemented and tested against a
real local Supabase instance. **Still not implemented from the MVP list above**: scheduling
reminders (data layer only, no actual notification delivery), recurring tasks (schema
intentionally closed, needs a `task_occurrences`-shaped change), personal calendar, shared
family calendar, shared task assignment UI, child events, drop-off/pickup responsibilities UI,
Family Today. See [roadmap](roadmap.md) for the concrete status of each.

## Explicitly deferred (not MVP)

Full list: [roadmap](roadmap.md). Everything V2/V3-tagged.

## See also

- [Product vision](product-vision.md)
- [Development workflow](../engineering/development-workflow.md) — recommended next phase
