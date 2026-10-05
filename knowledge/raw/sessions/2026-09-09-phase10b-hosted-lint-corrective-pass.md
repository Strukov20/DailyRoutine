# 2026-09-09 — Phase 10B: hosted lint corrective pass

Continuation on `release/mvp-beta`, after the repo owner linked a new hosted Supabase staging
project (ref `ocurkeddkqkeitjfbcbe`, `eu-west-1`) and deployed all 22 prior migrations
(confirmed Local/Remote parity via `migration list`). A hosted `supabase db lint` run
surfaced three findings, and the user's instructions were explicit: handle this as a narrow
corrective pass before continuing Stage B, investigate the actual root cause rather than
applying a mechanical fix, and never blindly reclassify `IMMUTABLE` to `STABLE` without first
determining whether the underlying expressions can instead be made genuinely immutable.

## What this session did

1. **Reproduced the hosted findings locally**, byte-for-byte, via `npx supabase db lint --local
   --level warning` against a freshly reset local instance (22 migrations, matching what was
   already deployed hosted) — confirmed local/hosted lint parity before touching anything.
2. **Root-caused both unused-variable warnings** by reading the actual function bodies:
   `set_responsibility_assignment`'s `v_event_id` (selected via `select r.family_id, r.event_id,
   ... into v_family_id, v_event_id, ...`, never read afterward — `r.event_id` is still needed
   in the join *condition* itself, just never selected out) and `update_event`'s `v_family_id`
   (selected, never read — this RPC authorizes via `owner_profile_id` alone). Both trivial,
   both removed with zero behavior change.
3. **Root-caused the `IMMUTABLE`-vs-`STABLE` warning empirically, not from the warning text
   alone** — queried `pg_proc.provolatile`, `pg_cast`, and `pg_type.typispreferred` directly
   against the local instance:
   - The daily branch's `(p_interval || ' days')::interval` invokes `interval_in` at runtime
     (string → interval cast), which `pg_proc` shows is `STABLE`. The monthly/yearly branches'
     `interval '1 month - 1 day'` *typed literal* syntax was never flagged, because Postgres
     parses that form to a `Const` at parse time — confirmed by checking both forms produce
     identical values but only one triggers the classification.
   - The weekly branch's `date_trunc('week', v_candidate)` (bare `date` input) is ambiguous:
     no `date_trunc(text, date)` overload exists, both `date→timestamp` and `date→timestamptz`
     casts are implicit, and Postgres's resolver breaks the tie via `typispreferred` — which
     favors `timestamptz` (confirmed via `pg_type`), silently routing through the `STABLE`
     overload.
   - Checked whether this was ever *actually* observable: ran the same calls under `UTC`,
     `Pacific/Kiritimati` (UTC+14), and `Etc/GMT+12` (UTC−12) session timezones before writing
     any fix. Identical output in every case — the round-trip is self-consistent for whole-day
     arithmetic, which is exactly why no prior test had ever caught this.
4. **Rejected `STABLE` as the fix** — nothing in the function actually needs the current
   query's timezone; every input is a plain argument. Declared `STABLE` would have silenced the
   linter while being a less accurate description of the function and unnecessarily pessimizing
   planner assumptions about its sole caller (`generate_task_occurrences`). Instead rewrote both
   call sites to structurally remove the `STABLE` dependency: `make_interval(days => p_interval)`
   for the daily branch (no string parsing at all) and an explicit `::timestamp` cast on
   `date_trunc`'s argument for the weekly branch (forces the correct, unambiguous overload).
   Verified via `EXPLAIN (VERBOSE, COSTS OFF)` that both rewrites now constant-fold for literal
   arguments, and via direct comparison that both produce byte-identical output to the prior
   expressions.
5. **Checked dependents before touching anything**: `pg_index`/`pg_get_indexdef` for any index
   referencing the function, `pg_attribute.attgenerated` for any generated column anywhere in
   the database — zero matches outside Supabase's own vendor schemas (unrelated). The function
   has zero grants and exactly one caller (`generate_task_occurrences`), confirmed via a grep
   across every migration for its name.
6. **New forward-only migration**: `20260912140100_fix_hosted_lint_warnings.sql` — three
   `CREATE OR REPLACE FUNCTION` statements, no `DROP`, no edit to any previously deployed
   migration file. Grants persist automatically across `CREATE OR REPLACE` (confirmed via the
   Phase 10 `is_family_member` precedent — no re-`GRANT` needed, matching that migration's own
   established pattern).
7. **New pgTAP file**: `190_hosted_lint_fixes_test.sql` (24 assertions) — monthly anchors
   (skip-invalid-anchor + interval), yearly/leap-year anchors (skip + advance-from-already-leap),
   weekly (both call sites the fix touched, including one round of miscalculated expected
   values in the first draft, caught by the actual test run and corrected against the real
   function output rather than re-guessed), daily (the make_interval rewrite), deterministic
   repeated calls, identical results across three session timezones, a still-zero-grants
   regression check (authenticated/anon denied), and the real caller path
   (`create_recurring_personal_task` → `generate_task_occurrences`) end to end for the two
   changed frequencies, plus one direct smoke assertion each for `update_event`/
   `set_responsibility_assignment`.
8. **Full verification, exactly the command list requested**: `npx supabase db reset` (23
   migrations, clean) → `npx supabase test db` (19 files, 602 assertions, all green) → `npx
   supabase db lint --local --level warning` (zero findings, all three warnings gone, none new)
   → `npm run verify` (65 suites/576 tests unchanged — no client code touched — wiki:lint
   clean) → `npx supabase db push --dry-run` against the linked staging project (reports
   exactly the one new migration as pending, confirming local/remote otherwise in parity). The
   real `supabase db push` was never run, per explicit instruction. The Supabase CLI (2.116.0)
   was not updated.
9. **Documentation**: a new "Phase 10B corrective pass" section in `docs/DECISIONS.md` (the
   full root-cause writeup); updated pgTAP counts and a new "Conventions established" bullet in
   `docs/TEST_STRATEGY.md` (the general lesson: verifying an `IMMUTABLE` claim needs a
   cross-session-timezone check, not just an `EXPLAIN`-based constant-fold check, which the
   planner would show either way since it trusts the declared volatility); a new note in
   `knowledge/wiki/engineering/recurring-tasks-and-reminders.md` (`compute_next_occurrence_date`
   had no direct documentation before this); `docs/RELEASE_CHECKLIST.md` updated to reflect the
   now-linked staging project, the clean hosted lint, and the still-pending real push.

## Deliberately not done this session

- The real `supabase db push` — the migration is ready and dry-run-verified, but pushing it for
  real needs the repo owner's go-ahead, consistent with every other Stage B write.
- Auth, Edge Function, EAS, or any other external deployment step — explicitly out of scope for
  this narrow corrective pass, per the user's own instruction.
- Updating the Supabase CLI — explicitly instructed not to.

## Verification

`npx supabase db reset` — 23 migrations, clean. `npx supabase test db` — 19 files, 602 pgTAP
assertions, all green (up from 18/578). `npx supabase db lint --local --level warning` — zero
findings (was 3). `npm run verify` — 65 suites/576 tests, lint/typecheck/wiki:lint all clean
(unchanged — no client code touched this pass). `npx supabase db push --dry-run` against the
linked staging project — exactly one pending migration, local/remote otherwise in parity. The
real push was never run.
