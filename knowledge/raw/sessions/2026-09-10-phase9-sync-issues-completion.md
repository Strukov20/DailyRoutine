# 2026-09-10 — Phase 9 completion pass: Sync Issues resolution UX

Continuation of the same `feature/realtime-offline-conflicts` branch as
[2026-09-09-phase9-realtime-offline-partial.md](2026-09-09-phase9-realtime-offline-partial.md)
and
[2026-09-09-phase9-conflict-center-and-integration-tests.md](2026-09-09-phase9-conflict-center-and-integration-tests.md).
User asked "ти завершив фазу?" ("did you finish the phase?") — answered honestly (two gaps
remained: full conflict-resolution UX, needing design input; native network/Android testing,
environment-limited). User then sent a full, extremely detailed "Phase 9 Completion Pass —
Sync Conflict Resolution UX" brief (16 sections) implementing exactly the first gap. This
session implemented it in full: product decision, UI, resolution logic, state machine,
database change, Jest coverage, pgTAP coverage, e2e:offline extension, documentation, and this
record. Mid-task, the user asked to pause and resume automatically after 90 minutes
(handled via chained `ScheduleWakeup` calls, since the tool clamps to 3600s max) — resumed
exactly where left off once the full 90 minutes elapsed.

## What this session did

1. **Product decision**: Sync Issues (`/sync-issues`) is a new, separate domain from the
   Conflict Center (`/conflicts`) — schedule conflicts vs. offline-queue synchronization
   failures, never sharing a badge or data source.
2. **Database**: `supabase/migrations/20260910120000_sync_issues_resolution.sql` —
   `P0002` (no_data_found) added alongside the existing `40001` convention, distinguishing
   "the row is gone" from `42501` "not yours" across all six affected RPCs. No new table
   needed (queue stays client-side persisted state). One real mistake made and caught by the
   pre-existing pgTAP suite: `schedule_personal_task`'s `p_date is null → 22023` check was
   dropped while rewriting the function, breaking `090_personal_task_management_test.sql`
   test 34 — restored, ordered before the existence lookup as the original had it. Two other
   pre-existing assertions in that same file (`an archived task is treated as gone... cannot
   complete it` / `cannot be updated either`) were updated from `42501` to `P0002` — a
   deliberate, expected behavior change from this pass, not a regression.
3. **Client-side vocabulary rewrite**: `src/lib/offline/types.ts`'s
   `OfflineOperationStatus`/`OfflineSafeErrorCode` replaced the old ad hoc
   `'pending'|'in-flight'|'failed'` union with the brief's own state names. Every downstream
   consumer (store selectors, replay engine, indicator, tests) updated to match — this was
   the single biggest source of mechanical rework in the session.
4. **New modules**: `src/lib/offline/syncIssueResolution.ts` (comparison building, Reload/
   Keep/Apply/Retry), `syncIssueDisplay.ts` (status labels, per-status action sets),
   `src/components/sync-issues/SyncIssueCard.tsx`, `app/sync-issues/index.tsx` (list),
   `app/sync-issues/[operationId].tsx` (comparison/resolution detail).
5. **A real, unrelated infinite-render-loop bug found and fixed**: `SyncStatusIndicator.tsx`
   and the Sync Issues list screen both passed `selectSyncIssues` (allocates a new array every
   call) directly to `useOfflineQueueStore(...)`. Zustand 5's `useSyncExternalStore`-based
   `useStore` reads a new-reference-every-render selector as "the store changed" every time,
   producing "Maximum update depth exceeded" — this silently broke `SyncStatusIndicator.test.tsx`
   and, as a knock-on, `CalendarScreen.test.tsx` (which renders the indicator). Fixed with
   `zustand/react/shallow`'s `useShallow` at both call sites. Genuinely reusable finding: any
   future array/object-valued Zustand selector on this store needs the same treatment.
6. **A second reusable finding**: the app's own singleton `queryClient` (from
   `@/lib/query/queryClient`) must never be wrapped directly in a component test's
   `QueryClientProvider` — its internal timers/subscriptions leaked across the whole Jest
   worker and hung the entire run past its 120s timeout. Fixed by giving
   `SyncIssueDetailScreen.test.tsx` its own fresh `new QueryClient({...})` per render, matching
   the pattern `QuickAddInput.test.tsx` already established.
7. **New Jest coverage**: `syncIssueDisplay.test.ts`, `syncIssueResolution.test.ts`,
   `SyncIssueCard.test.tsx`, `SyncIssuesScreen.test.tsx`, `SyncIssueDetailScreen.test.tsx` —
   list/comparison/resolution-action coverage per Section 11's list, plus the pre-existing
   `offlineQueueStore.test.ts`/`offlineQueueReplay.test.ts`/`SyncStatusIndicator.test.tsx`
   updated for the vocabulary rewrite. Final: 60 suites / 544 tests, all green.
8. **New pgTAP**: `supabase/tests/160_sync_issues_resolution_test.sql`, 20 assertions — the
   P0002/42501 split across all six RPCs, occurrence-RPC idempotent-replay, `update_
   personal_task` never touching an unrelated field, and a second concurrent write after a
   resolved conflict correctly re-raising `40001`. Final: 16 files / 528 assertions.
9. **`e2e:offline` extended** with a 14-step review/resolve scenario driving the real
   production `syncIssueResolution.ts` functions against the real local stack — also fixed one
   stale pre-existing assertion in this file (`status: 'failed'` → `status: 'conflict'`, a
   leftover from the vocabulary rewrite that the default `npm test` run can't catch since
   `e2e:offline` is a separate Jest project). Run twice consecutively without a DB reset, both
   green.
10. **A genuine design nuance surfaced, not silently resolved**: the brief's Section 5 says
    both "refetch latest authorized server version" (literally Apply's first step) *and* "if
    another update happened between review and application, remain in Needs review." As
    implemented, Apply always re-fetches fresh immediately before reapplying, so a write
    landing during the human review window is transparently picked up as the new base rather
    than re-surfaced for a second review — only a write racing *inside* Apply's own
    fetch-then-write pair still produces a renewed conflict. Documented in DECISIONS.md and
    ARCHITECTURE.md as a deliberate reading worth confirming, not assumed either way.
11. **Full verification**: `npm run verify`, `supabase db reset && supabase test db`,
    `deno test` for `dispatch-notifications`, all four backend e2e scripts, `e2e:offline`
    (twice) and `e2e:realtime` (twice), `expo config`/`expo-doctor`/both `expo export`
    platforms, `git diff --check`. `expo-doctor`: 20/21, one pre-existing unrelated patch-
    version drift (`expo`/`expo-router`), reported rather than bumped.

## Where to look

- Wiki: [engineering/realtime-sync-and-offline.md](../../wiki/engineering/realtime-sync-and-offline.md)
  (now `current`, not `proposed`).
- Canonical docs: `docs/ARCHITECTURE.md` ("Offline & caching (Phase 9)"),
  `docs/DECISIONS.md` ("Phase 9" → "Sync Issues resolution UX"), `docs/SECURITY_AND_PRIVACY.md`,
  `docs/ROADMAP.md` ("Offline behavior"), `docs/MVP_SCOPE.md`, `docs/TEST_STRATEGY.md`.
- Code: `src/lib/offline/`, `src/components/sync-issues/`, `app/sync-issues/`,
  `supabase/migrations/20260910120000_sync_issues_resolution.sql`,
  `supabase/tests/160_sync_issues_resolution_test.sql`.

## Still open (Phase 10, not this phase)

Real device network-interruption testing, native account-switch-no-flash observation, and
Android emulator/device runtime verification — explicitly deferred by the brief itself to a
Phase 10 manual release checklist, not blocking this phase's completion.
