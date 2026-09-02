---
title: Tasks and assignments
status: current
updated: 2026-09-02
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
tags: [domain, tasks, assignments]
---

## Confirmed

A shared task can be: unassigned, assigned to a specific adult, or self-claimed via **Take
Task**. Assigning a task **never means automatic acceptance** — the recipient must
explicitly Accept or Decline, the status is an explicit field (not inferred), and the full
assignment history is auditable.

## Schema: implemented

Two-table design:

- `tasks.assignment_status` — a fast-read **snapshot**: `unassigned | pending_acceptance |
accepted | declined`.
- `task_assignments` — the **append-only audit trail** that snapshot is derived from: one row
  per action (`assigned | took | accepted | declined | unassigned | reassigned`),
  `assigned_by_member_id` nullable (null = self-claimed via Take Task). No UPDATE/DELETE
  grant exists on this table for anyone — append-only is enforced at the grant level, not
  just by convention.

The snapshot is written by a `SECURITY DEFINER` trigger (`apply_task_assignment_action`)
reacting to `task_assignments` inserts — an assignee never gets direct UPDATE access to a
task row they don't own just to accept/decline their own assignment. Full detail:
[`docs/DATA_MODEL.md`, "task_assignments"](../../../docs/DATA_MODEL.md#task_assignments) and
[DECISIONS.md](../../../docs/DECISIONS.md).

**Constraint — implemented and tested**: a private task (`visibility = 'private'`) cannot
have an `assignee_member_id` other than its owner (`assert_task_integrity` trigger); an
assignee must belong to the task's own family (composite FK). See
[privacy-and-availability](privacy-and-availability.md) and
`supabase/tests/040_tasks_and_assignments_test.sql`.

## Current implementation

**Schema, RLS, and the assignment-action trigger exist** — proven by pgTAP (not yet run
against a live instance this session, see
[authentication](../engineering/authentication.md)). **UI still doesn't** — `app/task/new.tsx`
only proves the title-required validated-form path (`src/domain/tasks/schemas.ts`); no
assignment UI, no "Take task" button, no notifications yet.

## See also

- [Events and responsibilities](events-and-responsibilities.md) — a _different_ assignment
  concept (responsibility assignment) that must not be confused with task assignment; they
  share a similar accept/decline shape but are separate tables
- [Privacy and availability](privacy-and-availability.md) — the private-task/assignment
  constraint above
- [Testing strategy](../engineering/testing-strategy.md) — pgTAP conventions used to test this
