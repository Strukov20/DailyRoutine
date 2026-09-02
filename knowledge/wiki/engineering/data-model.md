---
title: Data model
status: proposed
updated: 2026-09-02
sources:
  - ../../../docs/DATA_MODEL.md
tags: [engineering, data-model, supabase]
---

## Status: proposed, not yet implemented

No Supabase project is connected and no migrations exist. This page (and
[`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md), which it summarizes) is the contract
the first migration should implement.

## Entities (full column lists in the doc)

`profiles`, `families`, `family_members` (unified adult+child — see
[family-spaces](../domain/family-spaces.md)), `family_invitations`, `categories`, `tasks`,
`task_assignments` (audit trail — see [tasks-and-assignments](../domain/tasks-and-assignments.md)),
`reminders`, `recurrence_rules`, `events`, `event_participants`, `responsibilities` (see
[events-and-responsibilities](../domain/events-and-responsibilities.md)),
`notification_tokens`.

**Availability/"Busy" is not a table** — it's a proposed Postgres view/RPC over `events`; see
[security model](security-model.md) and
[privacy-and-availability](../domain/privacy-and-availability.md).

**Audit columns** (`created_at`, `updated_at` via trigger, `created_by`) apply to every table
except `task_assignments`, which is append-only by design (its `created_at` _is_ its audit
story).

## Ownership summary (who owns what, who can read it)

See [`docs/DATA_MODEL.md`, "Ownership and authorization
summary"](../../../docs/DATA_MODEL.md#ownership-and-authorization-summary) for the full
table. Key points not to get wrong:

- `reminders` and `notification_tokens` are **owner-only, always** — never visible to other
  family members, even for a shared task.
- `tasks`/`events` split personal (`family_id NULL`) vs. shared (`family_id` set); a shared
  item can still be `visibility = 'private'` (family-linked for scheduling/Busy purposes, but
  full content owner-only) — this is why the assignment constraint in
  [tasks-and-assignments](../domain/tasks-and-assignments.md) exists.

## Unresolved

- Personal (non-family) custom categories — deferred, not decided. See
  [personal-planning](../domain/personal-planning.md).
- Recurrence materialization strategy (generate-ahead vs. on-read) — left as an
  implementation-phase decision in `docs/DATA_MODEL.md`, "recurrence_rules."

## See also

- [Security model](security-model.md) — the RLS design this schema is written against
- [Testing strategy](testing-strategy.md) — why RLS needs its own test layer
