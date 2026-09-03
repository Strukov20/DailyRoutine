---
title: Privacy and availability
status: current
updated: 2026-09-03
sources:
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/DATA_MODEL.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
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

## Status: implemented (mechanisms 1, 2, 5) / not yet implemented (3, 4)

`supabase/migrations/` implements and `supabase/tests/060_privacy_regression_test.sql` +
`090_personal_task_management_test.sql` (Phase 4's own secret-marker sweep, extended to the
personal-task RPC write path) prove mechanisms 1, 2, and 5 below — a secret marker planted in
every sensitive field of a private event/task is asserted absent from every non-owner query
path. Mechanisms 3 (Realtime) and 4 (notifications) remain undone, by design (still out of
scope through Phase 4). **Verified against a real local Postgres instance**
(`supabase test db`, all 192 assertions passing as of Phase 4) — see
[`knowledge/raw/sessions/2026-09-02-phase2-docker-resolved.md`](../../raw/sessions/2026-09-02-phase2-docker-resolved.md)
and
[`knowledge/raw/sessions/2026-09-03-phase4-personal-tasks.md`](../../raw/sessions/2026-09-03-phase4-personal-tasks.md).
Phase 4 also found and closed a real gap in Mechanism 1 for `tasks` specifically: the direct
`UPDATE` grant let a client rewrite `family_id` on their own task without revalidating family
membership the way `INSERT` did — see
[security-model](../engineering/security-model.md) for the fix (RPC-only writes).

## Mechanisms

1. **RLS on base tables** (`events`, `tasks`) — a non-owner's `SELECT` policy has no branch
   that returns a `visibility = 'private'` row belonging to someone else. The row is
   unreachable via the base table at all, not column-filtered. **Implemented.**
2. **A sanitized view is the only path to another member's data** — `family_schedule`/
   `family_task_board` null out `title`/`description`/`location` (etc.) in the query itself
   for private rows. **Corrected during implementation**: these views are deliberately not
   `security_invoker` — that would make them inherit mechanism 1's non-owner block and never
   show a Busy block for a private item at all. See
   [security-model](../engineering/security-model.md) for the full correction.
   **Implemented.**
3. **Realtime never re-broadcasts the raw row** — designed (shared sanitization + per-family
   broadcast channel, not naive `postgres_changes`) but **not implemented** — Realtime is out
   of scope this phase.
4. **Notifications** are owner-only for reminders (no cross-user path exists structurally);
   assignment notifications would only ever fire for `visibility = 'family'` tasks (the
   constraint that makes this safe — [tasks-and-assignments](tasks-and-assignments.md) — is
   implemented and tested), but no notification-sending code exists yet. **Not implemented.**
5. **Logs** — `src/lib/logger/logger.ts` and `src/components/ErrorBoundary.tsx` log
   identifiers/error messages only, never free-text content fields, by convention.
   **Implemented**, unchanged since Phase 1.

## See also

- [Events and responsibilities](events-and-responsibilities.md) — private events still
  produce a Busy block via the same `events` table
- [Security model](../engineering/security-model.md) — the engineering-facing index into the
  same mechanisms, including the security_invoker correction
- [Testing strategy](../engineering/testing-strategy.md) — the pgTAP conventions used to
  prove this rule
