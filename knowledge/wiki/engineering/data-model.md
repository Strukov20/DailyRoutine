---
title: Data model
status: current
updated: 2026-09-09
sources:
  - ../../../docs/DATA_MODEL.md
  - ../../../docs/DECISIONS.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-02-phase2-docker-resolved.md
  - ../../raw/sessions/2026-09-03-phase3-family-space.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
  - ../../raw/sessions/2026-09-06-phase6-push-notifications.md
  - ../../raw/sessions/2026-09-07-phase7-family-calendar.md
  - ../../raw/sessions/2026-09-08-phase8-recurring-tasks-reminders.md
  - ../../raw/sessions/2026-09-09-phase10-release-stabilization.md
tags: [engineering, data-model, supabase, phase10]
---

## Status: implemented

`supabase/migrations/` (24 files as of Phase 10) implements this schema against a local
Supabase project only — no hosted/production project connected. See
[`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md) for the normative description; the
migrations are the source of truth for exact syntax.

## Entities (full column lists in the migrations / doc)

`profiles`, `families`, `family_members` (unified adult+child — see
[family-spaces](../domain/family-spaces.md)), `family_invitations`, `categories`, `tasks`,
`task_assignments` (audit trail — see [tasks-and-assignments](../domain/tasks-and-assignments.md)),
`reminders`, `recurrence_rules`, `task_occurrences` (Phase 8 — generated occurrences of a
recurring personal task, see [recurring-tasks-and-reminders](recurring-tasks-and-reminders.md)),
`events`, `event_participants`, `responsibilities`,
`responsibility_assignments` (audit trail, Phase 7 — see
[events-and-responsibilities](../domain/events-and-responsibilities.md)),
`notification_tokens`, `notification_preferences` (Phase 6, gained
`reminder_titles_enabled` in Phase 8), plus a private `notifications`
schema (`outbox`, `deliveries`) not reachable via the client API at all — see
[Push notifications](push-notifications.md).

**Availability/"Busy" is not a table** — it's the `family_schedule`/`family_task_board`
views over `events`/`tasks`; see [security model](security-model.md) and
[privacy-and-availability](../domain/privacy-and-availability.md).

**Audit columns** (`created_at`, `updated_at` via trigger, `created_by`) apply to every table
except `task_assignments`/`responsibility_assignments`, which are append-only by design
(their `created_at` is their audit story).

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

**Phase 4 additions**: `tasks.deleted_at` (soft delete — see
[personal-planning](../domain/personal-planning.md)) plus two new `CHECK` constraints closing
real gaps (`tasks_time_requires_date`: a start time can no longer exist without a date;
`tasks_duration_minutes_bounded`: duration is now capped at 1440 minutes, not just positive).
`tasks`' `INSERT`/`UPDATE`/`DELETE` grants for `authenticated` were revoked entirely — see
[security model](security-model.md). Full reasoning:
[DECISIONS.md, "Phase 4"](../../../docs/DECISIONS.md).

**Phase 7 additions**: `events.deleted_at` (soft cancel, same convention as `tasks.deleted_at`);
`events`/`event_participants`/`responsibilities`' own `INSERT`/`UPDATE`/`DELETE` grants
revoked (the same audit-then-fix workflow as the Phase 4 entry above); a trigger rejecting a
responsibility on a private event; `has_member_schedule_conflict()`; two new sanitized views
(`family_responsibilities`, and `family_schedule` evolved to exclude soft-deleted rows and
expose `participant_member_id`); `notifications.outbox` gained nullable `event_id`/
`responsibility_id` columns (see [Push notifications](push-notifications.md)). Full
reasoning: [DECISIONS.md, "Phase 7"](../../../docs/DECISIONS.md) and
[Family calendar](family-calendar.md).

**Phase 8 additions**: `task_occurrences` (new table — bounded materialized occurrences of a
recurring personal task, `unique (task_id, original_date)` as the idempotency anchor);
`recurrence_rules` extended (`yearly` frequency, `count`, `stopped_at`); `reminders`'
`INSERT`/`UPDATE`/`DELETE` grants for `authenticated` revoked (RPC-only, pre-emptively rather
than an audit finding — see [security model](security-model.md)), plus new `occurrence_id`/
`is_snooze`/`label` columns and a `remind_at`-xor-`offset_minutes_before` CHECK;
`notification_preferences.reminder_titles_enabled` (new, defaults `false`);
`has_member_schedule_conflict()` extended (via `CREATE OR REPLACE`, signature unchanged) to
also check a member's own recurring occurrences and one-off timed personal tasks. Full
reasoning: [DECISIONS.md, "Phase 8"](../../../docs/DECISIONS.md) and
[Recurring tasks and reminders](recurring-tasks-and-reminders.md).

**Phase 10 additions**: `families.deleted_at`, `profiles.deleted_at` (soft delete, same
convention as `tasks`/`events`); new `family_ownership_transfers` table (append-only audit —
`family_id`, `previous_owner_member_id`, `new_owner_member_id`, `transferred_by`,
`transferred_at`; members can `SELECT`, no other grant); `families`/`profiles`' `UPDATE`
grants narrowed from blanket to explicit column lists excluding the new `deleted_at`/
`owner_id` columns (see [security model](security-model.md), "Family lifecycle mutations");
`is_family_member`/`is_family_owner`/`current_family_ids` (Phase 2, extended Phase 5) extended
again to exclude a deleted family. Full reasoning:
[DECISIONS.md, "Phase 10"](../../../docs/DECISIONS.md) and
[Family Spaces](../domain/family-spaces.md).

## Ownership summary (who owns what, who can read it)

See [`docs/DATA_MODEL.md`, "Ownership and authorization
summary"](../../../docs/DATA_MODEL.md#ownership-and-authorization-summary) for the full
table. Key points not to get wrong:

- `reminders`, `notification_tokens`, and `notification_preferences` are **owner-only,
  always** — never visible to other family members, even for a shared task. `reminders` writes
  are RPC-only since Phase 8; `SELECT` remains direct/RLS-governed.
- `task_occurrences` (Phase 8) is owned by the same profile as its parent `tasks` row
  (`owner_profile_id`, denormalized at generation time) — never a duplicate `tasks` row per
  occurrence.
- `notifications.outbox`/`deliveries` (Phase 6) aren't owned by any *user* at all in the usual
  sense — the whole schema is excluded from PostgREST's routing config, so no client role,
  including `service_role`, can reach it. See [Push notifications](push-notifications.md).
- `tasks`/`events` split personal (`family_id NULL`) vs. shared (`family_id` set); a shared
  item can still be `visibility = 'private'` (family-linked for scheduling/Busy purposes, but
  full content owner-only) — this is why the assignment constraint in
  [tasks-and-assignments](../domain/tasks-and-assignments.md) exists.

## Unresolved

- Personal (non-family) custom categories — still deferred, not decided. Phase 4 implemented
  basic custom-category creation, but family-scoped only (`create_custom_category`,
  owner-only) — a personal-scope column (e.g. `owner_profile_id`) was not added. See
  [personal-planning](../domain/personal-planning.md).
- ~~Recurrence materialization strategy (generate-ahead vs. on-read)~~ — resolved in Phase 8:
  bounded materialized occurrences (`task_occurrences`), generated lazily on demand into a
  45-day rolling horizon, never fully-ahead and never purely virtual. See
  [Recurring tasks and reminders](recurring-tasks-and-reminders.md).
- ~~No family-creation RPC exists yet~~ — resolved in Phase 3: `create_family_with_owner`
  atomically creates the family row and its owner's membership row; `families`/
  `family_members` still have no direct INSERT grant for `authenticated` by design. See
  [Family Spaces](../domain/family-spaces.md) and [DECISIONS.md](../../../docs/DECISIONS.md).
- ~~Family ownership transfer has no RPC~~ — resolved in Phase 10:
  `transfer_family_ownership`/`delete_family`/`leave_family`/`request_account_deletion`.
  `remove_family_member` still refuses unconditionally to remove a `role = 'owner'` row
  directly — by design, the owner now goes through one of those RPCs instead. See
  [Family Spaces](../domain/family-spaces.md).
- ~~`src/lib/supabase/types.ts` is hand-authored~~ — resolved: it's now the real generated
  output (`npm run db:types` run for real against the local stack). CHECK-constrained columns
  come back as `string` (a generator limitation, not a bug) — narrowed in domain mappers
  instead, e.g. `src/domain/profile/mappers.ts`.

## See also

- [Security model](security-model.md) — the RLS design this schema is written against
- [Recurring tasks and reminders](recurring-tasks-and-reminders.md) — `task_occurrences`/
  `reminders`/`recurrence_rules` in full (Phase 8)
- [Testing strategy](testing-strategy.md) — why RLS needs its own test layer
- [Authentication](authentication.md) — how `profiles` connects to `auth.users`
- [Family calendar](family-calendar.md) — the Phase 7 schema additions in full
