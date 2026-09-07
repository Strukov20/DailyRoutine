---
title: Security model
status: current
updated: 2026-09-08
sources:
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/DECISIONS.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-02-phase2-docker-resolved.md
  - ../../raw/sessions/2026-09-03-phase3-family-space.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
  - ../../raw/sessions/2026-09-05-phase5-shared-family-tasks.md
  - ../../raw/sessions/2026-09-06-phase6-push-notifications.md
  - ../../raw/sessions/2026-09-07-phase7-family-calendar.md
  - ../../raw/sessions/2026-09-08-phase6.1-push-deployment-validation.md
tags: [engineering, security, rls, privacy]
---

## Status: implemented and verified (Mechanisms 1, 2, 4, 5) / not yet implemented (3)

`supabase/migrations/` implements this design; `supabase/tests/` (pgTAP, all 387 assertions
across 13 files passing against a real local Postgres instance) proves it, particularly
`060_privacy_regression_test.sql`, `080_family_management_test.sql`,
`090_personal_task_management_test.sql`, `110_notification_outbox_test.sql`,
`120_family_calendar_test.sql`, and `130_security_regression_test.sql`. See
[privacy-and-availability](../domain/privacy-and-availability.md) for the domain-facing
version of this same content; this page is the engineering-facing index.

**Six real gaps have been found and fixed while implementing this, not bugs shipped and
later caught** — design corrections made during the same phase that built the feature:

- Mechanism 2 (sanitized views, Phase 2):
  [DECISIONS.md](../../../docs/DECISIONS.md#privacy-view-not-security_invoker--this-fixes-a-real-gap-in-the-phase-1-design).
- **`anon` had `EXECUTE` on every `SECURITY DEFINER` function (Phase 3)** — Supabase's own
  role bootstrap grants `anon`/`authenticated` EXECUTE directly at function-creation time,
  as ACL entries separate from `PUBLIC`; every `revoke all on function ... from public`
  statement in this codebase (Phase 2's included) never actually revoked `anon`'s access,
  confirmed by inspecting `pg_proc.proacl` on a real local instance rather than trusting the
  migration's own intent. Harmless for the three Phase 2 helpers (`auth.uid()` is null for
  `anon`) but a real hole for two Phase 3 invitation RPCs with no internal auth check. Fixed
  everywhere. Full writeup:
  [DECISIONS.md, "Phase 3"](../../../docs/DECISIONS.md).
- **`tasks` had a direct-`UPDATE` gap (Phase 4)** — the Phase 2 `UPDATE` policy's `WITH
CHECK` protected only `owner_profile_id`; a client could rewrite `family_id`,
  `assignee_member_id`, or `assignment_status` on their own task via a plain `PATCH`,
  bypassing the `task_assignments` audit trail and — since `family_task_board`'s
  authorization is the _viewer's_ family membership, not the _owner's_ — potentially exposing
  a task to a family its owner was never actually in. Fixed by revoking
  `INSERT`/`UPDATE`/`DELETE` on `tasks` entirely and moving every mutation to a
  `SECURITY DEFINER` RPC, continuing the Phase 3 RPC-only pattern. Full writeup:
  [DECISIONS.md, "Phase 4"](../../../docs/DECISIONS.md).
- **The Phase 3 anon-EXECUTE gap recurred on two new functions (Phase 6)** — despite the
  instruction to check `pg_proc.proacl` on every new `SECURITY DEFINER` function, the first
  draft of this phase's migration still missed it on
  `enqueue_task_assignment_notification` (the trigger function) and `backoff_interval` (an
  internal helper). Caught the same way as every prior time — a direct `pg_proc`/
  `has_function_privilege` query against a real local instance, not code review. This is
  evidence the checklist item is genuinely load-bearing, not a one-time Phase 3 cleanup. Full
  writeup: [DECISIONS.md, "Phase 6"](../../../docs/DECISIONS.md).
- **`events`/`event_participants`/`responsibilities` had the same direct-grant gap as `tasks`
  (Phase 7)** — these three tables (Phase 2) granted raw INSERT/UPDATE/DELETE to
  `authenticated` from the start; `responsibilities_owner_manages` let the event owner
  `UPDATE` a responsibility's `status`/`assignee_member_id` directly, bypassing the accept/
  decline/take state machine and its audit trail entirely. Closed identically to the `tasks`
  fix: grants revoked, every mutation moved to an RPC. Full writeup:
  [DECISIONS.md, "Phase 7"](../../../docs/DECISIONS.md).
- **Closed for good (Phase 6.1): a durable, automated regression guard**, not another manual
  catch. Three recurrences of the same finding (Phase 3, 5, 6) with no general-purpose test
  ever existing for it was the actual signal — `supabase/tests/130_security_regression_test.sql`
  queries `pg_proc`/`pg_namespace` directly (a schema-driven invariant, never a hardcoded
  function list, per the explicit instruction not to build a fragile grant snapshot) and
  asserts anon/PUBLIC can `EXECUTE` a function in `public`/`notifications` only if it's a
  trigger function (provably inert regardless of grant — Postgres refuses to invoke one
  outside trigger context) or is in a short reviewed whitelist. Verified the guard actually
  fails when the bug is reintroduced, not just when read.

## The five mechanisms

1. **RLS on base tables** — `events`/`tasks` `SELECT` policies have no branch returning a
   private row belonging to someone else; the row is unreachable at all via the base table.
   **Implemented.**
2. **Sanitized view** (`family_schedule`, `family_task_board`) — the only path to another
   member's data. **Corrected during implementation**: these are deliberately not
   `security_invoker` — a `security_invoker` view would inherit the base table's non-owner
   block from Mechanism 1 and could never show a Busy block for a private item at all. As
   ordinary (owner-executed) views, they bypass the querying user's RLS by construction, so
   the view's own `WHERE` clause is the entire authorization check, reviewed together with
   the sanitizing `CASE` expressions in one file. **Implemented.**
3. **Realtime via Broadcast-from-Database**, not naive `postgres_changes` on the base table.
   **Not implemented** — Realtime sync is out of scope this phase (see
   [roadmap](../product/roadmap.md)); `supabase/config.toml` has Realtime enabled globally
   but no table/broadcast trigger uses it yet. The design (a shared sanitization function
   used by both the view and a future broadcast trigger) still stands as the requirement for
   whoever adds it.
4. **Notifications** built server-side from the same authorized query path; never trust a
   client-supplied payload for what goes to another user. **Implemented (Phase 6) for shared
   family task assignment events, extended (Phase 7) to event-responsibility assignment
   events.** The push payload carries ids only — a discriminated union of `taskId` and
   `eventId` shapes, never both, never neither (see
   [`src/domain/notifications/payload.ts`](../../../src/domain/notifications/payload.ts)) —
   never task/event/user content; the on-device title/body are static strings chosen by
   `event_type`, not interpolated from row data. The recipient is derived entirely
   server-side, inside the same transaction as the mutation, from `family_members`/
   `task_assignments`/`responsibility_assignments` state — never from anything the client
   supplies. See [Push notifications](push-notifications.md) and
   [Family calendar](family-calendar.md) for the full design.
   - **4a. The `notifications` outbox schema is excluded from PostgREST routing entirely** —
     a schema-level control, not just RLS/grants, and the only mechanism in this document
     that holds even against `service_role`. See [Push notifications](push-notifications.md).
   - **4b. Conflict detection (Phase 7) returns a boolean only** —
     `has_member_schedule_conflict()` checks three private-content-bearing sources but never
     reveals which one, or any of its content. See [Family calendar](family-calendar.md).
5. **Logs** — `src/lib/logger/logger.ts` / `ErrorBoundary.tsx` log ids and error text only,
   never content fields. **Implemented**, unchanged since Phase 1 (it's app code, not a
   migration).

## Key implied constraint — implemented

A `visibility = 'private'` task cannot have `assignee_member_id` set to anyone but the owner
— enforced by the `assert_task_integrity` trigger on `tasks`
(`supabase/migrations/20260902120500_tasks.sql`), tested in
`supabase/tests/040_tasks_and_assignments_test.sql`. See
[tasks-and-assignments](../domain/tasks-and-assignments.md).

## Anti-recursion RLS helpers

`is_family_member()`, `is_family_owner()`, and `current_family_ids()`
(`supabase/migrations/20260902120200_families_and_members.sql` — not
`..._extensions_and_helpers.sql`; they had to move there because PostgreSQL resolves table
references inside a `LANGUAGE SQL` function body at `CREATE FUNCTION` time, so they can't be
defined before `family_members` exists) are `SECURITY DEFINER` functions that let a table's
own RLS policy check family membership without the classic recursive-policy problem (a
`family_members` policy that subqueries `family_members` directly would recurse infinitely).
Used throughout every table's policies instead of inline joins.

## Family/invitation/child-profile mutations are RPC-only (Phase 3)

`families`/`family_members`/`family_invitations` still have no direct `INSERT`/`UPDATE`/
`DELETE` grant for `authenticated` — every mutation is a narrowly scoped `SECURITY DEFINER`
RPC (`create_family_with_owner`, the five invitation RPCs, `create_child_profile`/
`update_child_profile`, `remove_family_member`) that enforces a business invariant RLS alone
expresses awkwardly: owner-orphan prevention (`remove_family_member` unconditionally refuses
to remove a `role = 'owner'` row), invitation-token validity, child-profile field limits. See
[Family Spaces](../domain/family-spaces.md) for the full RPC list and
[DECISIONS.md, "Phase 3"](../../../docs/DECISIONS.md) for why the table-write boundary from
Phase 2 was kept rather than opened up.

## Shared-task assignment mutations are RPC-only, and one helper has zero grants (Phase 5)

The nine assignment RPCs (`create_shared_family_task` through `restore_shared_task` — full
list in [tasks-and-assignments](../domain/tasks-and-assignments.md)) follow the same
`SECURITY DEFINER`, fixed-`search_path`, revoke-then-grant-`authenticated`-only pattern as
Phase 3/4. One goes further: `set_task_assignment`, the internal helper `assign_family_task`/
`reassign_family_task` both delegate to, has **no `grant execute` to any role at all** —
confirmed via `pg_proc.proacl`, not just by reading the migration's intent (the same
verification discipline the Phase 3 `anon`-grant finding established). It's reachable only
function-to-function from its two callers. The migration's first draft repeated the Phase 3
"Supabase grants `anon`/`authenticated` EXECUTE directly, `revoke ... from public` alone
doesn't touch it" mistake for this function specifically — caught and fixed before the
migration was applied, not after. Full writeup:
[DECISIONS.md, "Phase 5"](../../../docs/DECISIONS.md).

`remove_family_member`'s soft-delete (`removed_at`) means immediate access loss for a removed
member is enforced the same way as everywhere else in this design: `is_family_member()` and
the sanitized views' inline subqueries all filter `removed_at is null`, so there is no window
where a removed member's row still counts as active membership. Phase 7 extended this same
function to also resolve active *responsibility* assignments, not just task assignments.

## Calendar mutations are RPC-only too (Phase 7)

`events`/`event_participants`/`responsibilities` (Phase 2 schema) moved to the same RPC-only
pattern this phase — an audit finding, the identical class of gap Phase 4 found for `tasks`
(see "Four... five real gaps" above). The responsibility assignment RPCs
(`assign_event_responsibility` through `remove_event_responsibility`) mirror Phase 5's shape
exactly, including an internal `set_responsibility_assignment` helper with **no grant to any
role at all** — same pattern as `set_task_assignment`. `has_member_schedule_conflict` is
granted directly to `authenticated` (unlike the internal assignment helper) since it's
read-only and returns nothing sensitive — see Mechanism 4b above.

## Personal-task mutations are RPC-only too (Phase 4)

`tasks` has no direct `INSERT`/`UPDATE`/`DELETE` grant for `authenticated` — every mutation
(`create_personal_task`, `update_personal_task`, `complete_personal_task`/
`restore_personal_task`, `schedule_personal_task`, `move_task_to_inbox`,
`delete_or_archive_personal_task`, plus `create_custom_category` on `categories`) is a
`SECURITY DEFINER` RPC, same pattern as Family Space. `SELECT` remains direct/RLS-governed
(reads never had the write-path problem). See
[Personal planning](../domain/personal-planning.md) for the full RPC list and
[DECISIONS.md, "Phase 4"](../../../docs/DECISIONS.md) for the audit finding that motivated
closing this table's write grant specifically (it wasn't closed proactively — it was Phase
2's original design, tightened here after finding a real gap).

## Before enabling Realtime on any table

Confirm which broadcast mechanism is actually active — Supabase Realtime config is per-table,
and it's possible to enable naive `postgres_changes` broadcast by accident while adding an
unrelated feature. `docs/SECURITY_AND_PRIVACY.md` recommends this be a PR checklist item the
first time Realtime is turned on for `events`/`tasks`.

## See also

- [Data model](data-model.md) — the schema this design is written against
- [Testing strategy](testing-strategy.md) — RLS tests need a real Postgres instance; mocking
  Supabase for this class of test would test the mock, not the guarantee
- [Authentication](authentication.md) — how sessions/profiles connect to this RLS model
- [Family calendar](family-calendar.md) — the Phase 7 RPC-only conversion and Mechanism 4b
