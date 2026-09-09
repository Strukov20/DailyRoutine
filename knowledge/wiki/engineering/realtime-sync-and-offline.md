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
- **Bounded offline mutation queue** — `src/lib/offline/`, exactly six safe personal-task
  operations (create Inbox task, update/schedule/complete/restore/delete an existing one-off
  task). Idempotent by design: `client_operation_id` for create-replay,
  `expected_updated_at` precondition (errcode `40001`) for update/schedule, an op left
  `'in-flight'` by a crash is retried (not lost or assumed done) on next hydrate, and
  `remapClientGeneratedId` handles the one real ordering dependency (completing a task
  created earlier in the same offline session). Wired into
  `src/domain/tasks/hooks.ts`'s six mutation hooks — offline, each enqueues and applies the
  same optimistic cache update the online path already used.
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

## Not done yet — do not claim these are finished

- **Conflict Center UI.** `list_family_conflicts()` is built and tested server-side; there is
  no client domain/hooks/service layer for it yet, no `/conflicts` route, no badge on
  Calendar/Family Today. This is the largest remaining piece of the brief's UI surface.
- **Full manual conflict-*resolution*** (as opposed to detection). A stale-write conflict
  today surfaces only as the generic sync-status "Sync issue" + Retry — never a silent
  overwrite, but not yet the brief's dedicated "Sync conflict — this task changed on another
  device" flow with Reload/Review/Discard/Retry actions.
- **Real local Realtime WebSocket integration test** (`scripts/e2e-realtime.mjs`,
  `npm run e2e:realtime`) — specified in the brief, not written.
- **Offline integration test suite** against the production queue and real local RPCs
  (13 verification points specified in the brief) — not written. The 32 Jest tests in
  `src/lib/offline/` mock the RPC layer; they are not a substitute for this.
- **Recurring-occurrence complete/restore in the offline queue.** The brief's Section 9 list
  named this alongside the six one-off-task operations that are implemented; it was not
  wired in this pass.
- **Re-confirmation that e2e:backend/notifications/calendar/recurrence still pass** after the
  client-side Phase 9 changes — last confirmed green against the DB-layer commit only, before
  the client layer existed.
- **Native iOS/Android verification, and the Maestro policy decision** for any new flows —
  neither attempted yet this phase.

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
