---
title: Tasks and assignments
status: current
updated: 2026-09-03
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
  - ../../raw/sessions/2026-09-05-phase5-shared-family-tasks.md
tags: [domain, tasks, assignments]
---

## Confirmed

A shared task can be: unassigned, assigned to a specific adult, or self-claimed via **Take
Task**. Assigning a task **never means automatic acceptance** — the recipient must
explicitly Accept or Decline, the status is an explicit field (not inferred), and the full
assignment history is auditable. **Assignments this phase are Adult/Owner-only — a child
profile can never be an assignee** (`create_shared_family_task`/`set_task_assignment` reject
it server-side with `22023`, and the UI's `AssigneePicker` only ever lists adult members, so
the two layers agree rather than the UI merely hiding what the server would still allow).

## State machine (implemented, Phase 5)

```
Unassigned --Take--> Accepted (self)
Unassigned --Assign(self)--> Accepted (self, immediate — same as Take)
Unassigned --Assign(other)--> Pending
Pending --Accept--> Accepted
Pending --Decline--> Unassigned (audit entry kept; not deleted)
Accepted --Unassign--> Unassigned
Accepted/Pending --Reassign--> Pending (new recipient; stale old recipient can no longer Accept)
```

Completed tasks cannot be reassigned without an explicit `restore_shared_task` first; archived
(soft-deleted) tasks reject every assignment RPC outright. Every transition is a `SECURITY
DEFINER` RPC with `select ... for update` on the task row — no UI-only assumption ever decides
who currently holds a task.

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

## Current implementation (Phase 5 — complete)

**The full assignment workflow is implemented, RPC-only, and proven by pgTAP** (71 assertions,
`supabase/tests/100_shared_family_tasks_test.sql`) plus domain/UI Jest coverage. Nine RPCs,
each with one clear responsibility (mirroring Phase 4's personal-task RPC pattern):

- `create_shared_family_task(...)` — always `visibility = 'family'`; family comes from the
  caller's own current membership (`current_member_id`), never an arbitrary client-supplied
  ID; an optional `p_assignee_member_id` is validated and applied atomically (self → immediate
  `accepted`, other → `pending_acceptance`) rather than via a separate follow-up call.
- `assign_family_task` / `reassign_family_task` — thin wrappers over a shared internal helper,
  `set_task_assignment`, which has **no grant to any role at all** (not even `authenticated`)
  — callable only function-to-function from these two wrappers. See
  [security model](../engineering/security-model.md).
- `unassign_family_task`, `take_family_task`, `accept_task_assignment`,
  `decline_task_assignment`, `complete_shared_task`, `restore_shared_task`.

Every state-changing RPC locks the task row (`select ... for update`) and raises `40001`
(mapped client-side to `TaskErrorCode = 'conflict'`) when the caller's assumed prior state no
longer holds — the mechanism that makes **Take Task race-safe**: two concurrent callers can't
both win. See [DECISIONS.md, "Phase 5"](../../../docs/DECISIONS.md) for the full concurrency
and conflict-code writeup, including what pgTAP can and can't prove about true concurrency.

**Personal-task CRUD** (Phase 4 — see [personal-planning](personal-planning.md)) remains a
separate surface for creation/editing of a task's own fields, but an accepted shared
assignment now surfaces directly in the personal Today/Tomorrow views (via an `owner OR
accepted-assignee` query, `src/lib/tasks/taskService.ts`) — a _pending_ assignment does not,
appearing instead only in the Family board's "Awaiting your response" section and the Family
tab's badge count, so a task never looks like accepted personal work before the recipient has
actually accepted it.

**UI**: `FamilyTaskBoard` (`src/components/tasks/FamilyTaskBoard.tsx`, rendered from a
Members/Tasks toggle on `app/(app)/family.tsx`) — five sections (Awaiting your response, My
family tasks, Unassigned, Assigned to others, Completed), each task in exactly one section
(`src/domain/tasks/familyBoardSections.ts`, pure and unit-tested). No Realtime this phase —
pull-to-refresh only, and offline disables every assignment-state action (`FamilyTaskRow`'s
`disabled` prop, separate from `isBusy` so an offline board never implies a mutation is
in-flight) rather than showing a false "success." Creation/editing reuses
`TaskEditorForm` via an optional `sharedFamilyId` prop (forces Family visibility, no Private
option; create mode only, an optional Adult assignee) — see
[DECISIONS.md](../../../docs/DECISIONS.md) for why this wasn't a separate component.

## Member removal (Phase 5)

`remove_family_member` soft-deletes (`family_members.removed_at`) rather than hard-deleting,
specifically because this table's rows are referenced by permanent `task_assignments` audit
history. Before soft-deleting, it atomically resolves any of the removed member's
`pending_acceptance`/`accepted` assignments back to `unassigned` (with its own audit entry) —
a task can never stay silently assigned to someone who no longer has family access. See
[family-spaces](family-spaces.md) for the removal RPC itself.

## See also

- [Events and responsibilities](events-and-responsibilities.md) — a _different_ assignment
  concept (responsibility assignment) that must not be confused with task assignment; they
  share a similar accept/decline shape but are separate tables
- [Privacy and availability](privacy-and-availability.md) — the private-task/assignment
  constraint above
- [Testing strategy](../engineering/testing-strategy.md) — pgTAP conventions used to test this
