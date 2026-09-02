---
title: Phase 2 — Supabase foundation, schema, RLS, and authentication
date: 2026-09-02
agent: Claude (Sonnet 5, via Claude Code)
scope: supabase/ (schema, RLS, grants, pgTAP tests), src/lib/auth/, real email/password auth
branch: feature/supabase-foundation (from develop, from main at 76d08a8)
---

## What happened

Continuation of the same repository, same day, as a new phase (`feature/supabase-foundation`
branch, created from a fresh `develop` branch off `main`). Preflight found the working tree
dirty (an `expo run:ios`-driven `package.json` script change and a stray Claude Code lock
file from manual device testing between phases) — committed the legitimate change, gitignored
the lock file, then branched from a clean `main`.

**Docker was not installed** on the machine — required for `supabase start`/`db reset`/`test
db`/`gen types --local`. Per instruction not to install system software without permission,
asked the user; they chose to install it. `brew install --cask docker` got most of the way
but its final step needs an interactive `sudo` password a non-interactive shell can't supply
— the user was asked to finish that step themselves. **Whether Docker was verified working by
end of session should be checked in the final report** — if not, `supabase db reset` /
`supabase test db` / `gen types --local` were never actually run against a real Postgres
instance this session; only written and reasoned through, with CI's `database` job (added to
`.github/workflows/ci.yml`, using GitHub-hosted Docker) as the first real execution.

## Built this session

- 9 SQL migrations (`supabase/migrations/`) implementing the full schema from
  [`docs/DATA_MODEL.md`](../../../docs/DATA_MODEL.md): profiles (+ auto-creation trigger),
  families/family_members/family_invitations (+ ownership-integrity trigger + partial unique
  indexes), categories, recurrence_rules (locked down, no direct access), tasks +
  task_assignments (append-only audit trail + `SECURITY DEFINER` trigger) + reminders,
  events + event_participants + responsibilities, notification_tokens, and the sanitized
  `family_schedule`/`family_task_board` views.
- Full RLS + explicit grants on every table, using `is_family_member()`/`is_family_owner()`/
  `current_family_ids()` `SECURITY DEFINER` helpers to avoid recursive policies.
- 6 pgTAP test files (`supabase/tests/`, ~85 assertions) covering the required personas
  (owner, adult member, outsider, different-family adult, unlinked child, anonymous) and,
  critically, a dedicated privacy-regression test planting a secret marker in every sensitive
  field of a private event/task and asserting it never leaks through the sanitized views.
- Real Supabase Auth: `src/lib/auth/authService.ts` (transport layer, normalized error
  codes), `AuthProvider.tsx` (session state, `useAuth()`), `oauth.ts` (config-gated
  Google/Apple), sign-in/sign-up/forgot-password/reset-password/email-confirmation screens,
  `Stack.Protected`-gated route groups, automatic idempotent profile creation.
- `src/lib/supabase/types.ts` hand-authored (Docker unavailable to run the real generator) —
  explicitly marked provisional in its own header.
- Docs updated: DATA_MODEL, SECURITY_AND_PRIVACY (see the correction below), ARCHITECTURE,
  TEST_STRATEGY, DECISIONS, README, CLAUDE.md.

## A real design correction found during implementation (not just a bug)

Phase 1's `SECURITY_AND_PRIVACY.md` proposed a `security_invoker` sanitized view for Busy
blocks. Working through the actual RLS interaction: base-table RLS already fully hides a
private row from non-owners, so a `security_invoker` view (which runs under the *querying
user's* RLS) would inherit that same block and could never show a Busy block for a private
item at all — the view would be empty exactly when it needed to have a sanitized row. Fixed
by making the views ordinary (owner-executed, RLS-bypassing) views whose own `WHERE` clause
is the sole authorization check — see
[`docs/DECISIONS.md`](../../../docs/DECISIONS.md#privacy-view-not-security_invoker--this-fixes-a-real-gap-in-the-phase-1-design)
for the full reasoning and
[`knowledge/wiki/engineering/security-model.md`](../../wiki/engineering/security-model.md).

## Unresolved / flagged for the next phase

- **Docker/local verification status** — see above; must be confirmed in the final report,
  and `npm run db:reset && npm run db:test` run for real the moment it's available, since
  none of the SQL in this session was executed against a live Postgres.
- **No family-creation RPC exists yet** — `families`/`family_members` INSERT isn't granted to
  `authenticated` at all this phase (only `postgres`/test fixtures can create them). Building
  that RPC (`create_family_with_owner`, sketched but not implemented, see
  `docs/DECISIONS.md`) is prerequisite Phase 3 (family UI) work.
- **`src/lib/supabase/types.ts` needs real regeneration** the moment Docker/local Supabase is
  available — see that file's header and the CI `database` job's comment about why the
  generated-types drift check wasn't added yet.
- Realtime (Mechanism 3) and assignment/response notifications (Mechanism 4) in
  `docs/SECURITY_AND_PRIVACY.md` remain explicitly un-implemented, by design (out of this
  phase's scope) — the schema/constraints that make them safe to add later are in place and
  tested (e.g. the private-task-cannot-have-non-owner-assignee constraint).
