---
title: Privacy and availability
status: proposed
updated: 2026-09-02
sources:
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/DATA_MODEL.md
tags: [domain, privacy, security, critical-rule]
---

## The rule

A **Private** family-linked event or task exposes to non-owner family members only: owner,
start time, end time, and the literal fact "Busy." Title, description, category, notes, and
attachments must never reach a non-owner — **through any channel**: a direct API query, a
Supabase Realtime event, a push notification, a log line, or a client-side filter. Hiding a
field in the UI while the full row already reached the device does **not** satisfy this rule
— see [`docs/SECURITY_AND_PRIVACY.md`](../../../docs/SECURITY_AND_PRIVACY.md) for why that's
called out explicitly as the easiest way to get this wrong by accident.

## Status: proposed, not yet implemented

No migration exists yet, so none of this is enforced today — it is a **design**, written and
reviewed before any migration, per the brief's explicit instruction ("Document the proposed
security approach before implementing database migrations"). Treat every mechanism below as
a contract the first migration must implement, not as a description of current behavior.

## Proposed mechanisms (full detail in the doc)

1. **RLS on base tables** (`events`, `tasks`) — a non-owner's `SELECT` policy has no branch
   that returns a `visibility = 'private'` row belonging to someone else. The row is
   unreachable via the base table at all, not column-filtered.
2. **A sanitized view is the only path to another member's data** — `family_schedule` (and
   the task equivalent) nulls out `title`/`description`/`location` _in the query itself_ for
   private rows, via one shared SQL sanitization function reused everywhere (view +
   realtime), so the rule is defined exactly once.
3. **Realtime never re-broadcasts the raw row** — family-visible changes broadcast through
   the same sanitization function via Supabase's Broadcast-from-Database pattern on a
   per-family channel, not naive `postgres_changes` on the base table.
4. **Notifications** are owner-only for reminders (no cross-user path exists structurally);
   assignment notifications only fire for `visibility = 'family'` tasks (see the
   private-task/assignment constraint in
   [tasks-and-assignments](tasks-and-assignments.md)), so the recipient already has read
   access by construction.
5. **Logs** — `src/lib/logger/logger.ts` and `src/components/ErrorBoundary.tsx` log
   identifiers/error messages only, never free-text content fields, by convention (documented
   in those files) — this is currently the one mechanism above that _is_ live today, since
   it's app code, not a migration.

## Unresolved / explicitly flagged risk

**No RLS/privacy tests exist yet** — they can't, without a migration and a real Postgres
instance with RLS enabled (mocking Supabase for this would test the mock, not the guarantee).
Flagged in [`docs/TEST_STRATEGY.md`](../../../docs/TEST_STRATEGY.md) as the **highest-priority
test category to add the moment the first migration lands** — not a nice-to-have, a
correctness requirement for this exact rule.

## See also

- [Events and responsibilities](events-and-responsibilities.md) — private events still
  produce a Busy block via the same `events` table
- [Security model](../engineering/security-model.md) — the engineering-facing index into the
  same mechanisms
