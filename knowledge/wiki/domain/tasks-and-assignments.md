---
title: Tasks and assignments
status: current
updated: 2026-09-02
sources:
  - ../../../docs/PRODUCT.md
  - ../../../docs/DATA_MODEL.md
tags: [domain, tasks, assignments]
---

## Confirmed

A shared task can be: unassigned, assigned to a specific adult, or self-claimed via **Take
Task**. Assigning a task **never means automatic acceptance** — the recipient must
explicitly Accept or Decline, the status is an explicit field (not inferred), and the full
assignment history is auditable.

## Proposal (not yet implemented)

Two-table design:

- `tasks.assignment_status` — a fast-read **snapshot**: `unassigned | pending_acceptance |
accepted | declined`.
- `task_assignments` — the **append-only audit trail** that snapshot is derived from: one row
  per action (`assigned | took | accepted | declined | unassigned | reassigned`),
  `assigned_by_member_id` nullable (null = self-claimed via Take Task), never edited after
  insert.

This split exists specifically so "who decided what, when" survives even if two clients race
each other — the audit table isn't a field to merge, it's a log to append to. Full detail:
[`docs/DATA_MODEL.md`, "task_assignments"](../../../docs/DATA_MODEL.md#task_assignments).

**Constraint** (not yet enforced in a migration, since none exist): a private task
(`visibility = 'private'`) cannot have an `assignee_member_id` other than its owner — you
can't assign work to someone the privacy RLS policy would prevent from reading it. See
[privacy-and-availability](privacy-and-availability.md).

## Current implementation

Not implemented — `app/task/new.tsx` only proves the title-required validated-form path
(`src/domain/tasks/schemas.ts`); no assignment UI, no persistence, no notifications yet.

## See also

- [Events and responsibilities](events-and-responsibilities.md) — a _different_ assignment
  concept (responsibility assignment) that must not be confused with task assignment; they
  share a similar accept/decline shape but are separate tables
- [Privacy and availability](privacy-and-availability.md) — the private-task/assignment
  constraint above
