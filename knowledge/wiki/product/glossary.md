---
title: Glossary
status: current
updated: 2026-09-02
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
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
- **Inbox** — tasks with no `date` set.
- **Today / Tomorrow** — date-scoped personal views.
- **Family Today** — the combined, cross-member family schedule for the current day.
- **Task** — only `title` is mandatory; see [tasks-and-assignments](../domain/tasks-and-assignments.md).
- **Event** — has a start/end time; never carries a responsibility as a text field. See
  [events-and-responsibilities](../domain/events-and-responsibilities.md).
- **Responsibility** — a discrete, assignable duty tied to an event (e.g. drop-off, pickup),
  stored as its own row, never as event text. **The single most important domain
  distinction in the product** — see
  [events-and-responsibilities](../domain/events-and-responsibilities.md).
- **Take task** — an adult self-claims an unassigned shared task.
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
