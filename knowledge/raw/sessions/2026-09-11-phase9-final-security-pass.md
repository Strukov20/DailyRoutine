# 2026-09-11 — Phase 9 final security/concurrency pass

Continuation of the same `feature/realtime-offline-conflicts` branch, following directly on
[2026-09-10-phase9-sync-issues-completion.md](2026-09-10-phase9-sync-issues-completion.md).
User (mid-autonomous-loop-tick) sent an explicit, detailed 5-part brief asking for a security/
concurrency audit and fix of the just-completed Sync Issues resolution UX, specifically two
defects the user had independently identified: a task-existence oracle in the P0002/42501
split, and a concurrency gap in Apply my change's review semantics. This session implemented
both fixes in full, plus resolved a stray `deno.lock` and did the accompanying docs/wiki pass.

## What this session did

1. **Removed a task-existence oracle** (commit `47df0e7`, the immediately prior session's own
   work). The P0002 ("row doesn't exist") vs. 42501 ("row exists but isn't yours") split let an
   *authenticated* caller — who can pass any UUID, not only their own — learn whether a task
   with any given id exists anywhere in the system, for any user, regardless of ownership. Real
   cross-user information leak. Fixed with a new, additive migration
   (`20260911120000_remove_task_existence_oracle.sql` — the P0002 migration itself was never
   edited in place, matching this codebase's forward-only migration convention) collapsing
   "doesn't exist," "belongs to another profile," and "no longer visible" (soft-deleted) into
   one outcome: `42501`, one sanitized message per function, byte-for-byte identical for a
   random UUID and another profile's real id.
2. **Proved indistinguishability directly**, not just "both happen to be 42501" (which alone
   wouldn't rule out a distinguishing message) — rewrote `160_sync_issues_resolution_test.sql`
   around a `pg_temp.capture_error()` helper that runs a probe RPC call and captures its exact
   `sqlstate || '|' || sqlerrm`, then asserts byte-for-byte equality between a random
   (never-existed) UUID and another profile's real task/occurrence UUID, for every one of the
   six affected RPCs. 22 assertions (was 20), 530 total across 16 files (was 528).
3. **Fixed a real gap in Apply my change's review semantics.** The prior session's
   `applyMyChange` re-fetched the server row and used *that same fresh fetch* as both the
   staleness check and the write precondition — one step, not two — so a write landing between
   the user's actual review (opening the comparison screen) and pressing Apply was silently
   picked up as the new base, never re-shown to the user. Fixed by adding
   `OfflineOperation.reviewedVersion`, written only by a review action
   (`getConflictComparison`/`reloadServerSnapshot`), read (and, on mismatch, updated) only by
   `applyMyChange`. Two distinct concurrency windows now exist and are independently proven:
   "stale review" (a write between review and Apply — real, deterministic, end-to-end via
   `e2e:offline`) and "fetch-to-write race" (a write inside Apply's own fetch-then-write pair —
   sub-millisecond, proven at the unit level via mocking the RPC to reject after the version
   check passed, since real concurrent timing at that granularity can't be reproduced from
   sequential test code).
4. **Merged `OfflineSafeErrorCode`'s `'authorization_lost'`/`'entity_deleted'` into one
   `'task_unavailable'`** to match the server-side merge — the client has no way to show these
   as different outcomes any more, by design. `TaskErrorCode`/`RecurrenceErrorCode` drop
   `'not_found'` entirely.
5. **Extended `e2e:offline`'s 14-step scenario** with the real "stale review" window: a real
   second concurrent write lands after a real review, a real Apply attempt correctly refuses
   and refreshes the comparison, then a real second explicit Apply (nothing else having
   changed) succeeds. Also fixed one leftover stale assertion in this file from the prior
   session's own vocabulary rename (`status: 'failed'` → `'conflict'`) that only this separate
   Jest project — not the default `npm test` — could have caught.
6. **Resolved the stray root-level `deno.lock`.** Traced to running `deno test` from the repo
   root in an earlier session instead of the documented `cd supabase/functions && deno test`
   invocation — Deno materializes its lockfile relative to CWD, not to the nearest `deno.json`.
   The real, canonical lockfile (`supabase/functions/deno.lock`) has been tracked since Phase 6
   and was untouched. Deleted the stray root file, added `/deno.lock` to `.gitignore` to
   prevent recurrence (anchored to root only — `supabase/functions/deno.lock` is unaffected).
7. **Full documentation/wiki pass**: `docs/DECISIONS.md` (new "Final security/concurrency
   pass" subsection under Phase 9, added without editing the entries above it),
   `docs/SECURITY_AND_PRIVACY.md`, `docs/ARCHITECTURE.md`, `docs/TEST_STRATEGY.md`, this wiki
   page (`status: current` retained, "Apply my change's two concurrency windows" section
   replaces the earlier "concurrency nuance" note now that it's fixed rather than merely
   flagged), and this raw session record.

## Where to look

- Wiki: [engineering/realtime-sync-and-offline.md](../../wiki/engineering/realtime-sync-and-offline.md)
  — see "Apply my change's two concurrency windows" and the new task-existence-oracle bullet
  under "Done and verified."
- Canonical docs: `docs/DECISIONS.md` ("Phase 9" → "Final security/concurrency pass"),
  `docs/SECURITY_AND_PRIVACY.md`, `docs/ARCHITECTURE.md`, `docs/TEST_STRATEGY.md`.
- Code: `supabase/migrations/20260911120000_remove_task_existence_oracle.sql`,
  `supabase/tests/160_sync_issues_resolution_test.sql`, `src/lib/offline/types.ts`
  (`reviewedVersion`), `src/lib/offline/syncIssueResolution.ts` (`applyMyChange`'s two-window
  logic), `src/lib/offline/__e2e__/offlineQueue.e2e.test.ts` (Round 3 of the 14-step scenario).

## Verification

`npm run verify` (60 suites/550 tests), `supabase db reset && supabase test db` (16 files/530
pgTAP assertions), `deno test` (11/11, run from the documented `supabase/functions` directory),
`e2e:backend`/`e2e:notifications`/`e2e:calendar`/`e2e:recurrence` all re-confirmed,
`e2e:offline` and `e2e:realtime` each run twice consecutively with zero residue, both `expo
export` platforms, `git diff --check` — all clean. `expo-doctor` unchanged at 20/21 (same
pre-existing, unrelated patch-version drift). Nothing pushed or merged.
