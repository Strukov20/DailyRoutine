---
title: Tasks and assignments
status: current
updated: 2026-09-03
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
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

**Schema, RLS, and the assignment-action trigger exist and are proven by pgTAP against a real
local instance** (`supabase/tests/040_tasks_and_assignments_test.sql`). **Personal-task CRUD
now exists too** (Phase 4 — see [personal-planning](personal-planning.md)), but it is a
completely separate surface: none of the Phase 4 RPCs
(`create_personal_task`/`update_personal_task`/etc.) ever accept or set
`assignee_member_id`/`assignment_status`, and Phase 4's own RLS/grant audit _tightened_ the
`tasks` table's write path (see [security model](../engineering/security-model.md)) without
touching `task_assignments` at all. **Assignment UI still doesn't exist** — no "Take task"
button, no accept/decline UI, no notifications. This remains the next natural phase once
personal tasks are solid.

## See also

- [Events and responsibilities](events-and-responsibilities.md) — a _different_ assignment
  concept (responsibility assignment) that must not be confused with task assignment; they
  share a similar accept/decline shape but are separate tables
- [Privacy and availability](privacy-and-availability.md) — the private-task/assignment
  constraint above
- [Testing strategy](../engineering/testing-strategy.md) — pgTAP conventions used to test this
