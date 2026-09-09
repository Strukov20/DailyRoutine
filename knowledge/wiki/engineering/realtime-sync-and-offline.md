---
title: Realtime sync and offline resilience
status: proposed
updated: 2026-09-09
sources:
  - ../../../docs/ARCHITECTURE.md
  - ../../../docs/SECURITY_AND_PRIVACY.md
  - ../../../docs/ROADMAP.md
  - ../../../docs/MVP_SCOPE.md
  - ../../../docs/DECISIONS.md
  - ../../../docs/TEST_STRATEGY.md
  - ../../raw/sessions/2026-09-09-phase9-realtime-offline-partial.md
  - ../../raw/sessions/2026-09-09-phase9-conflict-center-and-integration-tests.md
tags: [engineering, realtime, offline, sync, conflicts, phase9]
---

## Status: Phase 9, in progress — this page tracks done vs. not-done, keep it current

Marked `proposed` rather than `current` because the phase this page documents is not finished.
Update the status to `current` only once the "Not done yet" list below is empty and the
Section 28 final report has been delivered. Full design/rationale for every decision below:
[DECISIONS.md, "Phase 9"](../../../docs/DECISIONS.md).

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
  an op left `'in-flight'` by a crash is retried (not lost or assumed done) on next hydrate,
  and `remapClientGeneratedId` handles the one real ordering dependency (completing a task
  created earlier in the same offline session). `complete_task_occurrence`/
  `restore_task_occurrence` needed no new RPC parameters at all — both are already idempotent
  server-side via a plain `WHERE status = ...` guard. Wired into `src/domain/tasks/hooks.ts`'s
  six mutation hooks and `src/domain/recurrence/hooks.ts`'s occurrence hooks — offline, each
  enqueues and applies the same behavior the online path already used.
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
  cross-account isolation), run twice consecutively, zero residue.
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

## Not done yet — do not claim these are finished

- **Full manual conflict-*resolution*** (as opposed to detection). A stale-write conflict
  today surfaces only as the generic sync-status "Sync issue" + Retry — never a silent
  overwrite, but not yet the brief's dedicated "Sync conflict — this task changed on another
  device" flow with Reload/Review/Discard/Retry actions.
- **Native network-disconnection testing, account-switch-no-flash, and Android** — see the
  native-verification bullet above for exactly what was and wasn't attempted.

## A genuinely non-obvious testing gotcha worth knowing before touching this code

RNTL's `act()` returns a promise in this installed version *even for a synchronous callback*.
An unawaited `act(() => {...})` doesn't fail the test that called it — it leaves a dangling
promise that resolves during whichever test runs next, corrupting *that* test's state in a way
that looks like a logic bug in the hook under test. `useRealtimeSync.test.tsx` hit exactly
this: 3 tests failed only in full-suite order, passed individually, and the actual defect was
one earlier test's missing `await`. See [TEST_STRATEGY.md](../../../docs/TEST_STRATEGY.md)'s
"Conventions established" list for the full writeup — the rule now: always `await act(async
() => {...})`, never a bare `act(() => {...})`, matching this codebase's existing
`render`/`fireEvent`/`renderHook` async convention.

## See also

- [system-architecture.md](system-architecture.md) — provider stack, state-management
  boundaries this phase's two new stores (offline queue, Realtime connection state) fit into.
- [privacy-and-availability.md](../domain/privacy-and-availability.md) — the Busy-block rule
  this phase's conflict-payload redaction (server-side, not yet client-surfaced) must keep
  intact once the Conflict Center UI exists.
