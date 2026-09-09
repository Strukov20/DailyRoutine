---
title: Realtime sync and offline resilience
status: current
updated: 2026-09-11
sources:
  - ../../../docs/ARCHITECTURE.md
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/ROADMAP.md
  - ../../../docs/MVP_SCOPE.md
  - ../../../docs/DECISIONS.md
  - ../../../docs/TEST_STRATEGY.md
  - ../../raw/sessions/2026-09-09-phase9-realtime-offline-partial.md
  - ../../raw/sessions/2026-09-09-phase9-conflict-center-and-integration-tests.md
  - ../../raw/sessions/2026-09-10-phase9-sync-issues-completion.md
  - ../../raw/sessions/2026-09-11-phase9-final-security-pass.md
tags: [engineering, realtime, offline, sync, conflicts, sync-issues, security, phase9]
---

## Status: Phase 9, complete

All sections of the phase's own brief are built and verified, including the completion pass's
Sync Issues resolution UX (the phase's last "Not done yet" item, now done — see below). Only
device-hardware-dependent scenarios are deferred, explicitly and non-blockingly, to a Phase 10
manual release checklist — see
[`docs/RELEASE_CHECKLIST.md`](../../../docs/RELEASE_CHECKLIST.md) and
[`docs/BETA_TESTING.md`](../../../docs/BETA_TESTING.md) for that checklist itself, now written.
Full design/rationale for every decision below: [DECISIONS.md, "Phase 9"](../../../docs/DECISIONS.md).

**Phase 10 addendum**: `families` had no broadcast trigger of its own (unlike
`family_members`); `delete_family` (see [Family Spaces](../domain/family-spaces.md)) now calls
the same `emit_invalidation` helper this mechanism is built on, so family deletion invalidates
every affected device the same way any other family-scoped change does — no new client-side
code needed.

## Done and verified

- **Realtime cross-device sync** — `src/lib/realtime/useRealtimeSync.ts`, one manager mounted
  once at the app root. Private Broadcast channels (`profile:<id>`, `family:<id>`), RLS-gated
  on `realtime.messages`, never `postgres_changes` on the base tables. Payloads are a fixed,
  content-free `{version, scope, entity, operation}` envelope — never a row, sanitized or
  not — validated and mapped to query-key prefixes by
  `src/lib/realtime/invalidationMap.ts`. See
  [SECURITY_AND_PRIVACY.md, "Mechanism 3"](../../../docs/SECURITY_AND_PRIVACY.md) for the full
  authorization design and [system-architecture.md](system-architecture.md) for where this
  sits in the provider stack.
- **Persistent, profile-partitioned offline read cache** —
  `src/lib/query/persistedQueryClient.ts`, the officially supported
  `PersistQueryClientProvider`/`createAsyncStoragePersister` pattern. Allowlisted (tasks,
  calendar, families, conflicts, categories only), cleared on real sign-out, never on token
  refresh. See [ARCHITECTURE.md, "Offline & caching (Phase 9)"](../../../docs/ARCHITECTURE.md).
- **Bounded offline mutation queue** — `src/lib/offline/`, the six safe personal-task
  operations (create Inbox task, update/schedule/complete/restore/delete an existing one-off
  task) plus recurring-occurrence complete/restore. Idempotent by design: `client_operation_id`
  for create-replay, `expected_updated_at` precondition (errcode `40001`) for update/schedule,
  an op left `'syncing'` by a crash is reset to `'retry_wait'` (retried, not lost or assumed
  done) on next hydrate, and `remapClientGeneratedId` handles the one real ordering dependency
  (completing a task created earlier in the same offline session). `complete_task_occurrence`/
  `restore_task_occurrence` needed no new RPC parameters at all — both are already idempotent
  server-side via a plain `WHERE status = ...` guard. Wired into `src/domain/tasks/hooks.ts`'s
  six mutation hooks and `src/domain/recurrence/hooks.ts`'s occurrence hooks — offline, each
  enqueues and applies the same behavior the online path already used. Operation status is
  `OfflineOperationStatus = 'pending' | 'syncing' | 'retry_wait' | 'conflict' |
  'permanent_failure' | 'discarded'` — see `src/lib/offline/types.ts`'s own doc comment for
  the full transition table.
- **Sync Issues resolution UX** (completion pass, then a final security/concurrency pass) —
  `app/sync-issues/index.tsx` (list, oldest first), `app/sync-issues/[operationId].tsx`
  (field-level comparison + resolution), `src/lib/offline/syncIssueResolution.ts`/
  `syncIssueDisplay.ts`. A **separate domain from the Conflict Center**: that screen is
  schedule conflicts (server-detected, `list_family_conflicts()`); this one is offline-queue
  synchronization failures (client-side queue state) — never sharing a badge, route, or data
  source. Four statuses (Waiting to retry / Needs review / Cannot be synchronized / Task no
  longer available), the brief's exact per-status action set (a stale-write conflict never
  offers a bare Retry — only Review changes / Reload latest server version), and four
  resolution flows: **Retry** (reuses the same operationId, joins the existing FIFO worker's
  singleton guard — never a duplicate concurrent attempt), **Keep server version / Discard**
  (terminal — the operation is removed, never replays again), **Apply my change** —
  concurrency-safe against two distinct windows via `OfflineOperation.reviewedVersion` (written
  only by a review action, never by Apply itself — see "Apply my change's two concurrency
  windows" below), never touching a field outside the original patch. No new server-side
  "operations" table needed — the queue itself is client-side persisted state; only
  idempotency/concurrency needs server support. See
  [DECISIONS.md, "Phase 9" → "Sync Issues resolution UX" and "Final security/concurrency
  pass"](../../../docs/DECISIONS.md) for the full state-machine and resolution-semantics
  writeup.
- **Final security/concurrency pass — a task-existence oracle found and removed.** A first
  version of the "task unavailable" work (commit `47df0e7`) distinguished "the row doesn't
  exist" (a new `P0002` code) from "the row exists but isn't yours" (`42501`) — but an
  *authenticated* caller can pass any UUID to these RPCs, not only their own, so that
  distinction let a caller learn whether a task with any given id exists anywhere in the
  system, for any user, regardless of ownership. A real cross-user information leak, not a
  cosmetic detail. Fixed (`supabase/migrations/20260911120000_remove_task_existence_oracle.sql`)
  by collapsing "doesn't exist," "belongs to another profile," and "no longer visible"
  (soft-deleted) into one outcome — `42501`, one sanitized message, byte-for-byte identical for
  a random UUID and another profile's real task/occurrence id — proven directly in
  `160_sync_issues_resolution_test.sql` via a `pg_temp` helper that captures and compares the
  exact `sqlstate || '|' || sqlerrm` each probe raises. Client-side, `OfflineSafeErrorCode`'s
  `'authorization_lost'`/`'entity_deleted'` merged into one `'task_unavailable'` to match — the
  Sync Issues UI has no way to show these as different outcomes, by design.
- **Sync-status UI** — `src/components/ui/SyncStatusIndicator.tsx`, Synced/Syncing/Pending
  changes: N/Sync issue (+ Retry), mounted next to `OfflineBanner` on
  Today/Tomorrow/Inbox/Calendar. `resolveSyncDisplayState` is the pure precedence function;
  see its own tests for the exact rules (a failed op always wins; "offline" defers entirely to
  `OfflineBanner` rather than repeating the signal).
- **Database layer** (built in the prior session, unchanged since): 7 broadcast triggers, the
  RLS policies on `realtime.messages`, the idempotency/precondition RPC parameters, and
  `list_family_conflicts()` — a deterministic, privacy-redacting conflict engine covering all
  8 required categories. 508 pgTAP assertions (15 files) passing against a real local
  instance.
- **Conflict Center** — `app/conflicts.tsx`, `src/domain/conflicts/`, `src/lib/conflicts/
  conflictService.ts`. Today/Upcoming (bounded 7-day) sections, a Review action that only
  navigates when the RPC's own redaction says it's safe, a badge on the Calendar tab/header
  sourced from the same query the screen itself uses. Read-only beyond Review, per the
  brief's own non-goals.
- **Real local Realtime WebSocket integration test** — `scripts/e2e-realtime.mjs`
  (`npm run e2e:realtime`), five real personas, 28 assertions, run twice consecutively, zero
  residue confirmed directly against the database both times.
- **Offline queue integration test** — `src/lib/offline/__e2e__/offlineQueue.e2e.test.ts`
  (`npm run e2e:offline`), driving the production queue against real local RPCs (idempotent
  create-replay, a real stale-write conflict that never overwrites the real row, real
  cross-account isolation, and a 14-step review/resolve scenario driving the real
  `syncIssueResolution.ts` functions: stale conflict → server fetch/compare (records
  `reviewedVersion`) → Keep server version → never replays → a second conflict → review →
  Apply my change → only the patched fields change → a third conflict → review → a further
  real concurrent write lands → Apply refuses to mutate ('stale_review', comparison refreshed
  in place) → an explicit second Apply, nothing else having changed, succeeds → a repeat Apply
  is a safe no-op → zero residue), run twice consecutively, zero residue. The tighter
  fetch-to-write race window (a write landing *inside* Apply's own fetch-then-write pair) is
  proven separately at the unit level — real concurrent timing at that granularity can't be
  reproduced from sequential test code.
- **Re-confirmed e2e:backend (32/32) / e2e:notifications (24/24) / e2e:calendar (28/28) /
  e2e:recurrence (23/23, twice)** all still pass after the full client-side Phase 9 change
  set — a real, pre-existing, date-hardcoded bug in `e2e-recurrence.sh` (unrelated to this
  phase's own code) was found and fixed along the way; see DECISIONS.md.
- **Native iOS verification** — a real `expo run:ios` debug build on an iPhone 17 Pro / iOS
  26.5 Simulator, Metro connected. The existing `personal_task_smoke.yaml` Maestro flow (sign
  in, quick-add, schedule, complete, restore) ran clean end to end — no regression from any
  Phase 9 change. Directly observed on-device: the sync-status indicator rendering "Synced";
  the Conflict Center rendering its real empty state, then — after an *external* `curl`-driven
  RPC call created two overlapping events, simulating another device — **live-updating with
  zero manual refresh** to show the real conflict, driven by the genuine Realtime
  broadcast → WebSocket → invalidate → refetch pipeline running for real on a physical-
  simulator device; the conflict badge rendering correctly both on the Calendar tab (native
  red badge) and as the in-screen chip, with the real count. The Review action's own logic is
  deterministically covered by `ConflictRow.test.tsx`; native tap-through verification of it
  specifically was inconclusive — this exact Simulator/Maestro combination has
  [DECISIONS.md](../../../docs/DECISIONS.md)-documented touch/assertion-delivery flakiness
  from Phase 5, and this pass independently reproduced a clear instance of it (an assertion
  reporting text as *not visible* that the same step's own screenshot shows clearly present).
  **Not attempted this pass**: true network-disconnection testing (offline cache/pending-sync/
  reconnect-replay) on-device — not safely automatable on this Simulator setup (same
  limitation Phase 8 already documented), covered instead by the deterministic
  `e2e:offline` suite; account-switch-no-flash; Android (no emulator available in this
  environment this pass).
- **Maestro policy decision for Phase 9 (Section 23)** — recorded in
  [DECISIONS.md](../../../docs/DECISIONS.md): no new Maestro flow added, existing coverage
  re-run as a regression check only, network-disconnection scenarios deliberately left to the
  deterministic `e2e:offline` suite instead (Maestro has no reliable way to simulate real
  connectivity loss on this Simulator setup).

## Not done yet — deferred to Phase 10, not blocking

- **Native network-disconnection testing, account-switch-no-flash, and Android** — see the
  native-verification bullet above for exactly what was and wasn't attempted; explicitly
  deferred to a Phase 10 manual release checklist by the completion pass's own brief.

## Apply my change's two concurrency windows

`OfflineOperation.reviewedVersion` (final security/concurrency pass) is written only by a
review action — `getConflictComparison`/`reloadServerSnapshot` — and read only by
`applyMyChange`, never written by it except as described below. Two distinct windows, both
refuse to mutate silently:

1. **Stale review** — a write lands *after* the user's last review, *before* they press
   Apply. `applyMyChange` fetches the live row, finds its `updated_at` no longer matches
   `reviewedVersion`, refuses to mutate, updates `reviewedVersion` to what it just fetched (so
   the *next* Apply has a correct baseline), and returns `{ result: 'stale_review' }` — the UI
   shows "This task changed again. Review the latest version." and stays on the comparison
   screen. Fully deterministic and covered end-to-end by `e2e:offline`'s 14-step scenario
   (a real second concurrent write between a real review and a real Apply attempt).
2. **Fetch-to-write race** — a write lands *inside* Apply's own fetch-then-write pair (the
   freshly-fetched version matched `reviewedVersion`, so Apply proceeded to replay, but
   another write commits before this one does). Caught by the RPC's own `40001` precondition
   check — `applyMyChange` returns `{ result: 'conflict' }`, distinct from `'stale_review'`.
   Not reproducible from sequential test code (the window is sub-millisecond, inside a single
   function call) — proven instead at the unit level in `syncIssueResolution.test.ts` by
   mocking the RPC call to reject with `'conflict'` despite the version check having just
   passed, the standard way to test a TOCTOU race deterministically.

Neither window ever falls back to last-write-wins, and Apply only ever sends the fields the
*original* local patch touched, regardless of which window (if either) fired. See
[DECISIONS.md](../../../docs/DECISIONS.md), "Final security/concurrency pass," for the full
writeup, including why an earlier version of this same completion pass didn't actually enforce
"review before apply" (it re-fetched and used that same fetch as both the check and the write
precondition, collapsing review and apply into one step).

## Genuinely non-obvious testing gotchas worth knowing before touching this code

RNTL's `act()` returns a promise in this installed version *even for a synchronous callback*.
An unawaited `act(() => {...})` doesn't fail the test that called it — it leaves a dangling
promise that resolves during whichever test runs next, corrupting *that* test's state in a way
that looks like a logic bug in the hook under test. `useRealtimeSync.test.tsx` hit exactly
this: 3 tests failed only in full-suite order, passed individually, and the actual defect was
one earlier test's missing `await`. See [TEST_STRATEGY.md](../../../docs/TEST_STRATEGY.md)'s
"Conventions established" list for the full writeup — the rule now: always `await act(async
() => {...})`, never a bare `act(() => {...})`, matching this codebase's existing
`render`/`fireEvent`/`renderHook` async convention.

**A Zustand selector that allocates a new array/object every call must be wrapped in
`useShallow`** (`zustand/react/shallow`) when passed to `useOfflineQueueStore(...)` (or any
Zustand 5 store in this codebase) — otherwise `useSyncExternalStore` reads "new reference" as
"store changed" on every render, producing an actual infinite render loop
("Maximum update depth exceeded"), not just a wasted re-render. Found via
`SyncStatusIndicator.tsx`/the Sync Issues list screen both passing `selectSyncIssues`
(`.filter().sort()` — a new array every call) directly to the hook. `selectOperationById`
(returns a stable reference or `undefined`) didn't need it — only array/object-valued
selectors do.

**Never wrap a component test's tree in the app's own singleton `queryClient`**
(`@/lib/query/queryClient`) via `QueryClientProvider` — its internal timers/subscriptions
persist across the whole Jest worker process and can hang the *entire test run* past Jest's
own timeout, not just fail one test. `SyncIssueDetailScreen.test.tsx` (which needs a real
`useQuery` for its comparison fetch) hit this directly. Always construct a fresh
`new QueryClient({ defaultOptions: { queries: { retry: false } } })` per test file, matching
the pattern `QuickAddInput.test.tsx`/`FamilyTaskBoard.test.tsx` already established.

## See also

- [system-architecture.md](system-architecture.md) — provider stack, state-management
  boundaries this phase's two new stores (offline queue, Realtime connection state) fit into.
- [privacy-and-availability.md](../domain/privacy-and-availability.md) — the Busy-block rule
  this phase's conflict-payload redaction (server-side, not yet client-surfaced) must keep
  intact once the Conflict Center UI exists.
