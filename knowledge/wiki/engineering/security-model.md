---
title: Security model
status: current
updated: 2026-09-03
sources:
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/DECISIONS.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-02-phase2-docker-resolved.md
  - ../../raw/sessions/2026-09-03-phase3-family-space.md
tags: [engineering, security, rls, privacy]
---

## Status: implemented and verified (Mechanisms 1, 2, 5) / not yet implemented (3, 4)

`supabase/migrations/` implements this design; `supabase/tests/` (pgTAP, all 136 assertions
passing against a real local Postgres instance) proves it, particularly
`060_privacy_regression_test.sql` and `080_family_management_test.sql`. See
[privacy-and-availability](../domain/privacy-and-availability.md) for the domain-facing
version of this same content; this page is the engineering-facing index.

**Two real gaps have been found and fixed while implementing this, not bugs shipped and
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
   client-supplied payload for what goes to another user. **Not implemented** — no
   notification-sending code exists yet; the constraint that makes it safe
   (`tasks_assert_integrity` rejects a private task with a non-owner assignee) is already in
   place and tested.
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
