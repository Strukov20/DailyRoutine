---
title: Glossary
status: current
updated: 2026-09-07
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
  - ../../raw/sessions/2026-09-06-phase6-push-notifications.md
  - ../../raw/sessions/2026-09-07-phase7-family-calendar.md
tags: [product, glossary]
---

Fast lookup for domain terms. Each links to the wiki page or doc with full detail.

- **Personal planner** — an individual adult's private task/event space. See
  [personal-planning](../domain/personal-planning.md).
- **Family Space** — a shared container an adult creates and invites other adults into. See
  [family-spaces](../domain/family-spaces.md).
- **Owner** — the adult who created a Family Space; a role, not a separate member type (see
  `family_members.role` in [data-model](../engineering/data-model.md)).
- **Adult member** / **Child profile** — both rows in the unified `family_members` table;
  a child has no account by default (`profile_id` nullable). See
  [family-spaces](../domain/family-spaces.md).
- **Active family** — which family the _UI_ currently focuses on when a user belongs to
  several; client-only state (`useUIStore.activeFamilyId`), not membership data.
- **Invitation** — a one-time, hashed capability token (not an emailed link — there is no
  email provider) an owner generates and shares via native Share/copy-link; whoever holds a
  valid, unexpired, still-pending token can accept it, regardless of their account's email
  address. See [family-spaces](../domain/family-spaces.md).
- **Inbox** — active personal tasks with no `date` set. See
  [personal-planning](../domain/personal-planning.md).
- **Today / Tomorrow** — date-scoped personal views, each split into **Overdue** (Today
  only — active tasks dated before today), **Timed** (has a `start_time`, sorted earliest
  first), **Anytime** (date set, no time, sorted by priority then creation order), and
  **Completed**. See [personal-planning](../domain/personal-planning.md) and
  `src/domain/tasks/sections.ts`.
- **Family Today** — the combined, cross-member family schedule for the current day.
  Implemented (Phase 7) as the Calendar screen's own Family mode, defaulted to today — not a
  separate screen. See [Family calendar](../engineering/family-calendar.md).
- **Task** — only `title` is mandatory; see [personal-planning](../domain/personal-planning.md)
  (personal tasks) and [tasks-and-assignments](../domain/tasks-and-assignments.md) (the
  family-facing assignment half, implemented Phase 5).
- **Event** — has a start/end time; never carries a responsibility as a text field.
  Implemented (Phase 7) — personal, family, or child events. See
  [events-and-responsibilities](../domain/events-and-responsibilities.md).
- **Responsibility** — a discrete, assignable duty tied to an event (e.g. drop-off, pickup),
  stored as its own row, never as event text. **The single most important domain
  distinction in the product.** Implemented (Phase 7), with its own assignment state machine
  (assign/reassign/take/accept/decline) mirroring task assignment — see
  [events-and-responsibilities](../domain/events-and-responsibilities.md).
- **Take task** — an adult self-claims an unassigned shared task (or, for a responsibility,
  the equivalent "Take" action).
- **Assignment** — assigning a task to a specific adult; requires explicit Accept/Decline,
  never assumed-accepted. See [tasks-and-assignments](../domain/tasks-and-assignments.md).
- **Private / Family visibility** — per-item flag on tasks/events. Private → other family
  members see only a sanitized "Busy" block. See
  [privacy-and-availability](../domain/privacy-and-availability.md).
- **Busy block** — the sanitized (owner, start, end, "Busy") view of a private item shown to
  non-owner family members.
- **Priority** — `Normal | Important | Critical`; mirrored client-side in
  `src/domain/tasks/priority.ts`.
- **Category** — `Work | Family | Home | Shopping | Health | Other` by default,
  family-extensible.
- **Notification outbox** — the durable table (`notifications.outbox`) a database trigger
  writes to inside the same transaction as an assignment mutation; a separate dispatcher sends
  from it later. See [Push notifications](../engineering/push-notifications.md).
- **Dispatcher** — the Deno Edge Function (`dispatch-notifications`) that claims outbox rows
  and sends them via Expo's Push Service. See
  [Push notifications](../engineering/push-notifications.md).
- **Conflict detection** — a deterministic, privacy-safe check for whether an adult is
  already busy at a given time (their own events, a timed task, or another accepted
  responsibility) — returns a warning only, never a title or what it conflicted with, and
  never blocks saving. See [Family calendar](../engineering/family-calendar.md).
