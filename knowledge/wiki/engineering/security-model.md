---
title: Security model
status: current
updated: 2026-09-02
sources:
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/DECISIONS.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
tags: [engineering, security, rls, privacy]
---

## Status: implemented (Mechanisms 1, 2, 5) / not yet implemented (3, 4)

`supabase/migrations/` implements this design; `supabase/tests/` (pgTAP) proves it,
particularly `060_privacy_regression_test.sql`. See
[privacy-and-availability](../domain/privacy-and-availability.md) for the domain-facing
version of this same content; this page is the engineering-facing index.

**A real gap was found and fixed while implementing Mechanism 2** — not a bug, a design
correction made before anything shipped. See
[DECISIONS.md](../../../docs/DECISIONS.md#privacy-view-not-security_invoker--this-fixes-a-real-gap-in-the-phase-1-design).

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
(`supabase/migrations/20260902120000_extensions_and_helpers.sql`) are `SECURITY DEFINER`
functions that let a table's own RLS policy check family membership without the classic
recursive-policy problem (a `family_members` policy that subqueries `family_members` directly
would recurse infinitely). Used throughout every table's policies instead of inline joins.

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
