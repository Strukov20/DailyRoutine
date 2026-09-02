---
title: Personal planning
status: current
updated: 2026-09-02
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
tags: [domain, personal, tasks]
---

## Confirmed

Every adult user has a personal planner: Today, Tomorrow, Inbox (date-less tasks), tasks
(with/without a scheduled time), calendar events, reminders (one or more per task),
recurring tasks, categories, priorities, and a Private/Family visibility flag per item.

**Task fields**: title, description, date, start time, duration, reminders, priority,
category, assignee, recurrence, visibility, completion status, assignment status. **Only
title is mandatory** — enforced today in `src/domain/tasks/schemas.ts`
(`newTaskSchema`), proposed at the database layer in
[data-model](../engineering/data-model.md) (`tasks.title NOT NULL`, everything else
nullable).

**Priorities**: `Normal | Important | Critical`. The client-side ordering logic
(`src/domain/tasks/priority.ts` — `getPriorityWeight`, `comparePriorityDescending`) is a
pure-function mirror of the same three-value enum proposed for the `tasks.priority` column;
keep them in sync if either changes.

**Default categories**: Work, Family, Home, Shopping, Health, Other — seeded as system rows
(`categories.is_system = true`, `family_id NULL`) in the proposed schema; users can add
custom ones (family-scoped, in the current schema proposal).

## Current implementation

Placeholder screens only (`app/(app)/today.tsx`, `inbox.tsx`) — no persistence, no real
Today/Tomorrow date filtering yet. The create-task modal (`app/task/new.tsx`) validates a
title via `newTaskSchema` and logs the submission; it does not write to a database yet.

## Proposal (not yet implemented)

Full column-level schema: [data-model](../engineering/data-model.md) →
[`docs/DATA_MODEL.md`, "tasks"](../../../docs/DATA_MODEL.md#tasks).

## Unresolved

Whether personal (non-family) custom categories should ship in MVP or wait for V2 — the
current schema proposal only allows family-scoped custom categories
(`categories.family_id`); a personal-scope column (e.g. `owner_profile_id`) was considered
and deferred, not rejected. See `docs/DATA_MODEL.md`, "categories."

## See also

- [Tasks and assignments](tasks-and-assignments.md) — the family-facing half of task
  behavior (assignment, Take Task)
- [Privacy and availability](privacy-and-availability.md) — what Private visibility means
