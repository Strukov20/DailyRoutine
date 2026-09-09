# 2026-09-09 — Phase 9 continued: Conflict Center, real integration tests, a real recurrence-script bug fix

Direct continuation of the same session as
[2026-09-09-phase9-realtime-offline-partial.md](2026-09-09-phase9-realtime-offline-partial.md),
picking up immediately after that entry's commits landed. User said "Фаза 9 повністю. Готова?"
("Phase 9 completely. Ready?") — answered honestly (not yet) and continued building the
remaining scope rather than stopping.

## What this session did

1. **Re-verified the DB layer and every existing e2e backend script** against the local
   Supabase stack (`supabase:start`, `db:reset`, `db:test`): 15 files, 508/508 pgTAP
   assertions. `e2e:backend` 32/32, `e2e:notifications` 24/24, `e2e:calendar` 28/28.
   `e2e:recurrence` initially failed 22/23 — a real, pre-existing bug: the script hardcoded
   its recurring task's creation date to `"2026-09-08"`, while the server's own 45-day
   occurrence horizon is anchored to `current_date` *at call time*; with real time having
   advanced to 2026-09-09, the fixed anchor now produced 47 occurrences instead of the
   expected ≤46, tripping the upper-bound check. Same class of wall-clock fragility as the
   Phase 8 Snooze Tonight/Tomorrow bug — unrelated to any Phase 9 code, found only because
   re-verification happened to run a day later than the script was authored. Fixed by
   computing "today" fresh on every run (`date -u +%Y-%m-%d`) instead of a fixed string;
   re-ran twice consecutively without a DB reset: 23/23 both times.
2. **Built the Conflict Center** (Section 15): `src/lib/conflicts/conflictService.ts` (the
   sole caller of `list_family_conflicts`), `src/domain/conflicts/` (types, a row mapper
   preserving the RPC's own privacy redaction, a `useFamilyConflicts` hook whose query key
   starts with `'conflicts'` so the existing Realtime invalidation map already refetches it),
   and `app/conflicts.tsx` (Today/Upcoming sections over a bounded 7-day window, via
   `ConflictRow`). A Review action navigates to the event/task editor only when the RPC's own
   output says that's safe (non-null, navigable entity id) — an occurrence, a responsibility,
   or anything redacted for privacy falls through to Family Today instead of guessing a route
   into someone else's private item. Added a conflict-count badge (same bounded window as the
   screen, so it never disagrees with what tapping through shows) to the Calendar tab and the
   Calendar screen's own header. New `conflicts.json` i18n namespace (en/uk).
   - `CalendarScreen.test.tsx` needed a static mock for the new `useFamilyConflicts` hook it
     now transitively renders (a real `useQuery` call with no `QueryClientProvider` in that
     test's render tree, since that file mocks every hook manually rather than wrapping a
     real provider) — 12 tests initially failed with "No QueryClient set" until fixed.
3. **Built the real local offline-queue integration test** (Section 20):
   `src/lib/offline/__e2e__/offlineQueue.e2e.test.ts`, run via a new `jest.e2e.config.js` /
   `npm run e2e:offline`. Drives the *production* queue code (`offlineQueueStore.ts`,
   `offlineQueueReplay.ts`) against the real local Supabase stack through the app's own
   `taskService.ts` — never a mocked RPC layer. Two real environment problems found and fixed
   before it worked at all:
   - The shared `jest-expo` preset's own `setupFiles` install a React Native `fetch`/XHR
     polyfill that silently resolves every real network request with an undefined
     status/body under Jest (confirmed directly: a bare `fetch()` against the local stack
     came back with `res.status === undefined`) — no native networking module exists under
     Jest for it to actually call. Fixed by *not* using the `jest-expo` preset for this one
     config: plain `testEnvironment: 'node'` plus a manual `babel-jest` transform gives Node
     24's own genuine, unpatched global `fetch`.
   - `babel-preset-expo`'s env-var inlining plugin rewrites every `process.env.EXPO_PUBLIC_*`
     read into an import of a real-but-ES-module file (`expo/virtual/env.js`), which then
     failed to parse under the default "don't transform node_modules" rule. Fixed with a
     narrow `transformIgnorePatterns` carve-out for exactly that one virtual-module path.
   - The suite's own first real run left 6 residual test users in the database: cleanup
     deleted accounts via `auth.admin.deleteUser`, but any account that still owned a `tasks`
     row failed with a `23503` foreign-key violation (`tasks.owner_profile_id_fkey` does not
     cascade) — a genuinely undeletable-until-fixed real account, not a test artifact. Fixed
     by deleting each account's owned tasks via the service-role client first, with each
     deletion independently caught so one failure never aborts cleanup for the rest; manually
     purged the 6 already-leaked rows/users this had left behind. Re-ran twice consecutively:
     4/4 both times, zero residue confirmed directly against the database after each run.
4. **Built the real local Realtime WebSocket integration test** (Section 19):
   `scripts/e2e-realtime.mjs`, run via `npm run e2e:realtime`. Five real personas (an owner's
   two separate real connections — "client A" and "client B," simulating two devices on the
   same account — an active adult family member, an outsider, and a member removed from the
   family mid-run), each a genuine WebSocket subscription against the real local Realtime
   server (never a simulated `realtime.topic` GUC, which is what the pgTAP suite already
   covers). 28 assertions passed on the *first* real attempt, run twice consecutively, zero
   residue confirmed directly against the database both times.
   - One assumption corrected before writing the script, by reading the actual trigger SQL
     first rather than guessing: a private, family-linked event's mutation *does* broadcast
     to `family:<family_id>` (not withheld the way I'd initially assumed) — `broadcast_event_
     change` fires whenever `family_id` is set, regardless of `visibility`. This is correct
     precisely because the payload itself never carries content; a family member's client
     just refetches through the already-redacted `family_schedule` view. The script verifies
     the real property that matters instead: every payload, including this one, is confirmed
     content-free by the same secret-marker sweep used throughout.
   - The removed-member scenario observed (not merely asserted) that their *pre-existing*
     connection still received a broadcast after removal, while a *brand-new* subscription
     attempt (a fresh client/session) correctly failed — recorded as the documented Supabase
     per-connection authorization-caching limitation (see SECURITY_AND_PRIVACY.md, "Mechanism
     3"), not treated as a bug either way.
5. Updated `knowledge/wiki/engineering/realtime-sync-and-offline.md`'s "Done"/"Not done yet"
   split to match — still `status: proposed`, not `current`, since native verification and
   the full manual conflict-resolution UI remain outstanding.

## Verified

`npm run verify` run clean after every commit: 54 suites, 456 tests, lint/typecheck/wiki:lint
all clean. `e2e:offline` and `e2e:realtime` each run twice consecutively with zero residue
confirmed by direct database queries (not just the scripts' own self-reported cleanup).

## Explicitly not done in this session

The full manual conflict-*resolution* UI (Section 11) — a stale-write conflict still surfaces
only as the generic sync-status "Sync issue" + Retry. Recurring-occurrence complete/restore in
the offline queue. Native iOS/Android verification (attempted next, in the same overall Phase
9 effort, but not yet completed as of this raw file). The Maestro policy decision. The final
Section 25 verification checkpoint and Section 28 report.

## Agent

Claude (Sonnet 5, via Claude Code).
