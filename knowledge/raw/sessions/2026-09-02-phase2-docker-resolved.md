---
title: Phase 2 follow-up — Docker resolved, full local verification completed
date: 2026-09-02
agent: Claude (Sonnet 5, via Claude Code)
scope: Resolves the "Docker unavailable" blocker recorded in 2026-09-02-phase2-supabase-foundation.md
---

## What happened

The user asked to finish the remaining manual setup from the Phase 2 report (Docker install +
running `db:reset`/`db:test`/`db:types` for real). `brew install --cask docker` had
previously failed on a step requiring interactive `sudo` (writing a symlink into the
root-owned `/usr/local/bin`) that a non-interactive shell can't complete.

**Worked around without needing that sudo step**: Homebrew had already downloaded and
checksum-verified `Docker.dmg` into its cache before the earlier failed install rolled back.
Mounted that cached, verified dmg directly, copied `Docker.app` into `/Applications` (writable
without sudo — the user is in the `admin` group, which owns `/Applications`), and symlinked
the bundled CLI tools into `/opt/homebrew/bin` (user-writable, already on `PATH`) instead of
the problematic `/usr/local/bin`. The one unavoidable manual step — Docker Desktop's
first-launch privileged-helper installation, which requires a macOS GUI authorization
dialog — was completed by the user after `open -a Docker`.

## Real bugs found by running against a live instance (not hypothetical)

Two categories of bugs surfaced immediately by actually running `supabase db reset` and
`supabase test db`, neither previously catchable without a real Postgres instance:

1. **Migration ordering**: the three family-membership RLS helper functions
   (`is_family_member`/`is_family_owner`/`current_family_ids`) were originally defined in the
   very first migration, before `family_members` existed. PostgreSQL resolves table
   references inside a `LANGUAGE SQL` function body at `CREATE FUNCTION` time — contrary to
   the assumption recorded in the original session — so this failed immediately with
   `relation "public.family_members" does not exist`. Fixed by moving the functions into the
   migration that creates that table.
2. **Test assertion bugs** (not schema bugs): several "anonymous sees zero rows" pgTAP
   assertions assumed RLS would silently filter results to empty; in fact `anon` has no
   `GRANT` at all on these tables, so the query is rejected with `42501` before RLS is even
   evaluated. Fixed to use `throws_ok` with the real expected SQLSTATE. Also fixed one test
   in `020_families_and_members_test.sql` whose fixture data tripped a *different*, also-valid
   constraint (`assert_family_owner_consistency`) before it could reach the one-owner-per-family
   unique index it was meant to isolate.

## Verified for real (not just unit tests against mocks)

- `supabase db reset` — all 9 migrations apply cleanly from scratch. Deterministic, confirmed
  by running it twice.
- `supabase test db` — **all 88 pgTAP assertions pass** across all 7 test files.
- `supabase gen types typescript --local` — real generated types committed, replacing the
  hand-authored placeholder. Confirms `Tables<T>`/`TablesInsert<T>`/`TablesUpdate<T>` helper
  shapes; confirms CHECK-constrained columns come back as `string` (Postgres limitation, not
  a bug) — `src/domain/profile/mappers.ts` updated to narrow defensively rather than widening
  the domain type.
- **End-to-end smoke test against the real local stack**: `curl` sign-up via the real Auth
  REST endpoint → confirmed a `profiles` row was auto-created by the trigger with the correct
  `display_name` from signup metadata → confirmed the confirmation email arrived in Mailpit.
  This is the first time any part of this schema/auth implementation has been proven against
  a real running system rather than reasoned through or mocked.
- `npm run verify`, `expo-doctor`, `expo export --platform ios` all still pass after the
  fixes above (typecheck catches nothing broken by the real generated types beyond the one
  expected narrowing fix).

## Status change

Every "not run this session" / "unverified" caveat recorded in the original Phase 2 session
source, `docs/DECISIONS.md`, `docs/TEST_STRATEGY.md`, and the wiki pages listed in
`knowledge/wiki/log.md`'s corresponding entry is now resolved. `.env` was created locally
(git-ignored) pointing at the local stack, using the well-known local-only demo anon key
Supabase ships with every local project (not a secret).

## Remaining for a future session

- Google/Apple OAuth real credentials — still genuinely deferred, requires the user to create
  accounts/credentials in each provider's console (see `docs/DECISIONS.md`).
- No family-creation RPC yet — still the hard prerequisite for Phase 3, unrelated to this
  Docker/verification follow-up.
