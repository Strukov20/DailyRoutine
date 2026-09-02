---
title: Data model
status: current
updated: 2026-09-02
sources:
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
tags: [engineering, data-model, supabase]
---

## Status: implemented

`supabase/migrations/` (9 files) implements this schema against a local Supabase project
only — no hosted/production project connected. See [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md)
for the normative description; the migrations are the source of truth for exact syntax.

## Entities (full column lists in the migrations / doc)

`profiles`, `families`, `family_members` (unified adult+child — see
[family-spaces](../domain/family-spaces.md)), `family_invitations`, `categories`, `tasks`,
`task_assignments` (audit trail — see [tasks-and-assignments](../domain/tasks-and-assignments.md)),
`reminders`, `recurrence_rules`, `events`, `event_participants`, `responsibilities` (see
[events-and-responsibilities](../domain/events-and-responsibilities.md)),
`notification_tokens`.

**Availability/"Busy" is not a table** — it's the `family_schedule`/`family_task_board`
views over `events`/`tasks`; see [security model](security-model.md) and
[privacy-and-availability](../domain/privacy-and-availability.md).

**Audit columns** (`created_at`, `updated_at` via trigger, `created_by`) apply to every table
except `task_assignments`, which is append-only by design (its `created_at` is its audit
story).

## Refinements made during implementation (beyond the original doc)

- **Denormalized `family_id`** on `task_assignments`/`event_participants`/`responsibilities`
  (trigger-populated from the parent row, never client-writable) — enables a composite-FK
  "assignee must be in the same family" check and non-recursive RLS.
- **`timezone` columns** on `events` (`NOT NULL`), `tasks` (nullable, required with
  `start_time`), and `recurrence_rules` (`NOT NULL`).
- **No native Postgres `ENUM`s** — every status/type/role column is `text` + `CHECK`, for
  evolvability (recorded project decision — see [DECISIONS.md](../../../docs/DECISIONS.md)).
- **`families.owner_id`** consistency is a validating trigger + partial unique index on
  `family_members`, not a value auto-computed from it (would have a chicken-and-egg ordering
  problem — see DECISIONS.md).

Full reasoning for each: [DECISIONS.md, "Phase 2"](../../../docs/DECISIONS.md).

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
- **No family-creation RPC exists yet** — `families`/`family_members` INSERT isn't granted to
  `authenticated` this phase; only migrations/test fixtures create rows. A
  `create_family_with_owner` `SECURITY DEFINER` RPC is the anticipated Phase 3 solution to the
  chicken-and-egg problem of creating a family and its owner's membership row atomically
  under RLS — sketched but not built. See [DECISIONS.md](../../../docs/DECISIONS.md).
- `src/lib/supabase/types.ts` is hand-authored, not generated (Docker was unavailable at
  write time) — regenerate for real (`npm run db:types`) the moment a local stack is running.

## See also

- [Security model](security-model.md) — the RLS design this schema is written against
- [Testing strategy](testing-strategy.md) — why RLS needs its own test layer
- [Authentication](authentication.md) — how `profiles` connects to `auth.users`
