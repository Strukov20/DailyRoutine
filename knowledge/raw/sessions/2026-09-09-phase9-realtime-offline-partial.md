# 2026-09-09 — Phase 9 (Secure Realtime Sync, Offline Resilience, Conflict Center): partial progress

Continuation of a prior compacted session that had already built and committed the full
database layer (`615c040`) — Realtime Broadcast Authorization, offline-mutation idempotency
RPC parameters, and the deterministic conflict engine — plus a types regeneration commit
(`eee7cac`), against a 28-section brief. This session picks up mid-brief, with the client
layer partially built (persistent cache, Realtime manager skeleton, `useRealtimeSync` test
suite mid-debug) and continues it.

## What this session did

1. **Fixed `useRealtimeSync.test.tsx`'s 3 order-dependent failures.** Root cause: one test
   called `act(() => {...})` with a synchronous callback but never `await`ed it. RNTL's `act()`
   in the installed version always returns a promise, sync callback or not — the unawaited
   promise resolved asynchronously during the *next* test's execution, corrupting its
   fake-channel bookkeeping. Fixed by awaiting every `act()` call in the file. All 11/11 pass,
   independent of run order.
2. **Fixed a `react-hooks/refs` lint error** the wiring surfaced — `useRealtimeSync.ts` wrote
   to a ref during render (`flushInvalidationsRef.current = () => {...}` inline in the hook
   body). Moved the write into a dependency-less `useEffect`.
3. Wired `useRealtimeSync()` into `app/_layout.tsx`; ran full `npm run verify` clean; committed
   the persistent-cache and Realtime-manager client layers as two separate logical commits.
4. **Built the offline mutation queue** (`src/lib/offline/`) from scratch: types/identity
   schema, AsyncStorage-backed persistence, a Zustand in-memory mirror
   (`offlineQueueStore.ts`), the FIFO replay worker (`offlineQueueReplay.ts`), and the
   lifecycle hook (`useOfflineQueueSync.ts`) wiring replay to auth restoration/NetInfo
   reconnect/foreground/manual retry. 32 new Jest tests, all passing.
   - Found and fixed a real correctness gap before it shipped: completing a task that was
     itself created offline (not yet synced) would reference the task's not-yet-real
     `clientGeneratedId` as its `entityId` — added `remapClientGeneratedId`, invoked after a
     successful create replay, to rewrite any dependent queued op to the real server id.
   - Found and fixed a second gap: an operation left `'in-flight'` by a crash mid-replay would
     never be picked up again (the replay loop only selects `'pending'` ops) — `hydrate()` now
     resets any leftover `'in-flight'` op back to `'pending'` on load, since every queued RPC
     is idempotent and safe to retry blindly.
5. **Wired the queue into the six personal-task mutation hooks**
   (`src/domain/tasks/hooks.ts`): while offline, each enqueues instead of calling the RPC and
   applies the equivalent optimistic cache update (a new Inbox row under its client-generated
   id for create; the existing `onMutate` optimistic patch for complete/restore; in-place
   patches for update/schedule/delete). A dated (scheduled) offline create is refused with a
   clear error — Section 9 scoped queued creation to an unscheduled Inbox task only.
   `taskService.ts`'s create/update/schedule now pass the Phase 9 RPC parameters
   (`clientOperationId`, `expectedUpdatedAt`).
   - This required fixing 3 pre-existing test files (`hooks.test.tsx`,
     `FamilyTaskBoard.test.tsx`, `QuickAddInput.test.tsx`) that hadn't needed to mock
     AsyncStorage before — any test rendering a component that pulls in
     `domain/tasks/hooks.ts` now transitively loads the offline queue store.
6. **Built the shared sync-status indicator** (`src/components/ui/SyncStatusIndicator.tsx`):
   Synced/Syncing/Pending changes: N/Sync issue (with Retry), icon+text (never color-only),
   backed by real state (`uiStore.realtimeStatus` + the offline queue's selectors). Mounted
   alongside `OfflineBanner` on Today/Tomorrow/Inbox/Calendar. A pure `resolveSyncDisplayState`
   function carries the state-precedence rules so they're unit-testable without mounting a
   component (11 tests). New `common:sync.*` i18n keys (en/uk).
7. Updated documentation to match: `docs/SECURITY_AND_PRIVACY.md` (Mechanism 3 rewritten from
   a Phase-2-era "not implemented yet, planned design" note to the actual implementation, plus
   a new offline-cache-privacy paragraph), `docs/ARCHITECTURE.md` (corrected the stale provider
   diagram, added "Realtime sync (Phase 9)" and rewrote "Offline & caching (Phase 9)"),
   `docs/ROADMAP.md` (moved the built subset out of "V2, design before building" into
   "implemented," precisely scoped what's still V2 — full manual conflict-resolution UI,
   last-write-wins-by-default, offline editing beyond a personal task),
   `docs/MVP_SCOPE.md` (same correction, briefer), `docs/DECISIONS.md` (a new "Phase 9 — in
   progress" entry covering the Broadcast-vs-Postgres-Changes decision, the
   `realtime.topic()` GUC-simulation testing gotcha, the idempotency/stale-write RPC design,
   offline queue scope, the FIFO dependency-chaining fix, and the deferred
   conflict-resolution UI), and `docs/TEST_STRATEGY.md` (corrected the stale pgTAP file/test
   counts to 15 files/508 assertions, and recorded two new testing conventions: the
   unawaited-`act()` dangling-promise finding, and the `react-hooks/refs` fix pattern).

## Verified

`npm run verify` (lint + typecheck + Jest + wiki:lint) run clean after every commit in this
session, most recently: 51 suites, 427 tests, zero failures. The pgTAP/Deno/e2e:backend/
e2e:notifications/e2e:calendar/e2e:recurrence counts from the prior session's DB-layer commit
(`615c040`) were not re-run in this session — no migration or RPC changed since then, only
client-side code, so no reason to expect them to have regressed, but this has **not been
re-confirmed** and should be before Phase 9 is called complete.

## Explicitly not done in this session (see the wiki page for full status)

Conflict Center UI (no client domain/hooks/service/route layer exists yet for
`list_family_conflicts`, though the DB function itself is built and tested). The real local
Realtime WebSocket integration test (`scripts/e2e-realtime.mjs`). The offline integration test
suite (Section 20). Native iOS/Android verification. The Maestro policy decision. The full
manual conflict-resolution UI (Section 11) — only detection + a generic "Sync issue" surfaces
today. Re-confirming zero regressions in the existing e2e backend scripts. The final Section 25
verification checkpoint and Section 28 report.

## Agent

Claude (Sonnet 5, via Claude Code).
