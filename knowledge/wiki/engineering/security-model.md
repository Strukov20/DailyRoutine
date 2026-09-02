---
title: Security model
status: proposed
updated: 2026-09-02
sources:
  - ../../../docs/SECURITY_AND_PRIVACY.md
tags: [engineering, security, rls, privacy]
---

## Status: proposed, not yet implemented

Written and reviewed before any migration exists, per explicit brief instruction. See
[privacy-and-availability](../domain/privacy-and-availability.md) for the domain-facing
version of this same content; this page is the engineering-facing index.

## The five mechanisms (full SQL sketches in the doc)

1. **RLS on base tables** — `events`/`tasks` `SELECT` policies have no branch returning a
   private row belonging to someone else; the row is unreachable at all via the base table.
2. **Sanitized view** (`family_schedule`, and a task equivalent) — the _only_ path to another
   member's data; nulls sensitive columns in the query itself via one shared SQL function,
   not per-caller filtering.
3. **Realtime via Broadcast-from-Database**, not naive `postgres_changes` on the base table —
   a trigger calls the same sanitization function before broadcasting to a per-family
   channel.
4. **Notifications** built server-side from the same authorized query path; never trust a
   client-supplied payload for what goes to another user.
5. **Logs** — `src/lib/logger/logger.ts` / `ErrorBoundary.tsx` log ids and error text only,
   never content fields. This is the one mechanism that's live today (it's app code, not a
   migration).

## Key implied constraint

A `visibility = 'private'` task cannot have `assignee_member_id` set to anyone but the owner
— you cannot assign work to someone the RLS policy prevents from reading it. To be enforced
by a `CHECK` constraint (or trigger) at migration time; not yet written since no migration
exists. See [tasks-and-assignments](../domain/tasks-and-assignments.md).

## Before enabling Realtime on any table

Confirm which broadcast mechanism is actually active — Supabase Realtime config is per-table,
and it's possible to enable naive `postgres_changes` broadcast by accident while adding an
unrelated feature. `docs/SECURITY_AND_PRIVACY.md` recommends this be a PR checklist item the
first time Realtime is turned on for `events`/`tasks`.

## See also

- [Data model](data-model.md) — the schema this design is written against
- [Testing strategy](testing-strategy.md) — RLS tests need a real Postgres instance; mocking
  Supabase for this class of test would test the mock, not the guarantee
