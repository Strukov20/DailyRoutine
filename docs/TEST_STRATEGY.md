# Test Strategy

## Layers

| Layer                   | Tool                                                                                          | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain logic            | Jest                                                                                          | Pure functions in `src/domain/**` — priority ordering, validation schemas, auth/family/task error-code mapping, row-to-domain mappers' fallback narrowing, date-only utilities (UTC/Kyiv/negative-offset/DST/midnight-boundary determinism — see DECISIONS.md, "Phase 4"), Today/Tomorrow section-bucketing and sorting, notification push-payload schema validation (Zod, every documented event type, rejects an unknown schema version/malformed shape without throwing), calendar day-boundary/interval-overlap arithmetic and the event editor's kind-specific validation rules (Phase 7)                                                                                                                                                                                                                                                                                                                                  | `src/domain/tasks/{priority,schemas,mappers,dateUtils,sections,errorMessages}.test.ts`, `src/domain/auth/errorMessages.test.ts`, `src/domain/family/{errorMessages,mappers}.test.ts`, `src/domain/categories/mappers.test.ts`, `src/domain/notifications/payload.test.ts`, `src/domain/calendar/{dateUtils,schemas,mappers}.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Components              | Jest + React Native Testing Library                                                           | Reusable UI primitives (`src/components/ui/**`) and feature components (`src/components/tasks/**`, `src/components/calendar/**`) rendered and interacted with — accessibility state (`accessibilityState.checked`, not color alone), double-submit/duplicate-tap prevention, the Day Calendar's Personal/Family modes, member filters, chronological rendering, Busy-block non-navigability, and conflict-warning content (no private title ever rendered)                                                                                                                                                                                                                                                                                                                                                                                                            | `src/components/ui/EmptyState.test.tsx`, `src/components/tasks/{TaskRow,QuickAddInput}.test.tsx`, `src/components/calendar/{ResponsibilityRow,EventEditorForm,CalendarScreen}.test.tsx` (Phase 7 follow-up — see below for why the Calendar Day view's own test lives in `src/components/calendar/` rather than co-located with `app/(app)/calendar.tsx`). `EventEditorForm.test.tsx` is scoped to what's reliably observable under RNTL, per the same `react-native-paper` `<Menu>` limitation Phase 5 documented — trigger buttons, disabled state, and validation/submission logic are tested; opened-menu content is not. |
| Repositories / services | Jest, with `@/lib/supabase/client` mocked at the module boundary                              | Every `<feature>Service.ts`'s row-mapping and SQLSTATE → typed-error-code normalization (see ARCHITECTURE.md, "Layering"); `notificationService.ts`'s simulator/emulator short-circuit, permission-denied/registration-failure typed errors, and logout-time token deactivation (never throws, even if the underlying call does)                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/lib/family/familyService.test.ts`, `src/lib/tasks/taskService.test.ts`, `src/lib/categories/categoryService.test.ts`, `src/lib/notifications/notificationService.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Query/selection hooks   | Jest + RNTL's `renderHook`, with the service module mocked                                    | Non-trivial hook logic beyond thin TanStack Query wiring — `useActiveFamily()`'s fallback-to-first-family selection; `useCompletePersonalTask`'s optimistic update **and its deterministic rollback on a simulated server failure** (see ARCHITECTURE.md, "Optimistic updates are the exception"); `useNotificationResponseRouter`'s cold-start/background/foreground tap handling, signed-out pending-route preservation, malformed-payload safe-ignore, and response-id dedup                                                                                                                                                                                                                                                                                                                                                                        | `src/domain/family/hooks.test.tsx`, `src/domain/tasks/hooks.test.tsx`, `src/lib/notifications/notificationResponseRouter.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Localization            | Jest                                                                                          | i18next initializes correctly; every namespace has matching keys across `en`/`uk`; a given key actually translates differently per locale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/i18n/i18n.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Auth / config           | Jest, with `@/lib/supabase/client` and `@/lib/env` mocked at the module boundary              | Missing Supabase configuration, localized error mapping, unavailable OAuth provider configuration, session loading/signed-in/signed-out routing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/lib/env.test.ts`, `src/lib/auth/authService.test.ts`, `src/lib/auth/oauth.test.ts`, `src/lib/auth/AuthProvider.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| RLS / privacy           | pgTAP via `supabase test db`, against a real local Postgres instance with RLS enabled         | Non-owner cannot read a private row's sensitive columns via the base table or the sanitized view; the required personas (owner, adult member, outsider, different-family adult, unlinked child, anonymous) each get the correct allow/deny outcome per table; the "Event ≠ Responsibility" worked example (renaming an event leaves its responsibilities untouched, `due_at` derives from the event and never drifts); append-only enforcement on `task_assignments`/`responsibility_assignments`; every family/invitation/child-profile/personal-task/shared-task/notification/calendar RPC's permission and validity checks, and that `anon` truly has no `EXECUTE` on any of them (see DECISIONS.md, "Phase 3," for why this needed a dedicated real-instance check rather than trusting the migration's own `revoke` statement) — for notifications specifically, that the entire `notifications` schema (not just its RLS) is inaccessible to `authenticated`/`anon`; for calendar specifically, the responsibility assignment state machine, Busy-block privacy for private family-linked events, and `has_member_schedule_conflict`'s half-open interval semantics; and (Phase 6.1) a durable, schema-driven regression guard asserting that the anon/PUBLIC-EXECUTE invariant holds for *every* function in `public`/`notifications`, present or future, not just the ones a migration author remembered to test individually | **Implemented and verified** — `supabase/tests/*.sql` (15 files, `Files=15, Tests=508` as of Phase 9 — see `010`–`150`: `110_notification_outbox_test.sql` (Phase 6, 30 assertions), `120_family_calendar_test.sql` (Phase 7, 92 assertions — 88 original + 4 added in the Phase 7 follow-up audit closing a gap where the `declined`/`taken` notification event types had no pgTAP assertion of their own), `130_security_regression_test.sql` (Phase 6.1, 6 assertions), `140_recurring_tasks_reminders_test.sql` (Phase 8), and `150_realtime_offline_conflicts_test.sql` (Phase 9, 47 assertions — Realtime topic RLS for profile/family/outsider/removed-member/malformed/anon personas, no client INSERT on `realtime.messages`, generic-payload-content checks, offline-operation idempotency and cross-user isolation, stale-write conflicts for both `update_personal_task`/`schedule_personal_task`, all 8 conflict-detection categories, conflict-id stability, and secret-marker sweeps over both broadcast payloads and conflict rows)). All 508 assertions pass against a real local instance (`supabase db reset && supabase test db`), plus real curl-driven multi-user flows for Family Space, personal tasks, shared tasks, notifications, and the calendar (owner/member/outsider, real `auth.users` accounts) — see `scripts/e2e-backend.sh`/`e2e:backend`, `scripts/e2e-notifications.sh`/`e2e:notifications`, `scripts/e2e-calendar.sh`/`e2e:calendar`, and docs/DECISIONS.md for the Phase 3–9 and 6.1 final reports. Phase 9's own real local Realtime WebSocket integration test and offline-integration test suite are implemented and passing — `scripts/e2e-realtime.mjs`/`npm run e2e:realtime` (5 real WebSocket personas, 28 assertions) and `src/lib/offline/__e2e__/offlineQueue.e2e.test.ts`/`npm run e2e:offline` (the production offline queue against real local RPCs, via `jest.e2e.config.js`), each run twice consecutively with zero residue confirmed directly against the database. See `knowledge/wiki/engineering/realtime-sync-and-offline.md` for current status. |
| Edge Functions          | Deno's built-in test runner (`deno test`), against a real local Postgres instance and a fake `PushTransport` | `dispatch-notifications`'s full claim → send → classify → receipt-check flow (`supabase/functions/dispatch-notifications/index.test.ts`) — never a real Expo network call, but a real database (real claiming/locking, real status transitions, real token deactivation). Re-verified unaffected by Phase 7's `notifications.outbox` schema extension (nullable `event_id`/`responsibility_id` columns) | **Implemented** — 11 test steps, all passing (`cd supabase/functions && deno test --allow-net --allow-env`). Complements, not replaced by, `110_notification_outbox_test.sql` above: pgTAP proves the *data model* (grants, triggers, recipient derivation); this proves the *dispatcher code* (claiming, backoff, ticket/receipt handling, token deactivation) against that same real schema. |
| Build/bundle smoke test | `npx expo export --platform ios` / `--platform android`, `npx expo config`, `npx expo-doctor` | Catches the class of failure lint/typecheck cannot (see DECISIONS.md's `expo-router`/`@react-navigation/native` entry)                                                                                                                                                                                                                                                                                                                                                                                                                                   | Run manually every phase so far; wired into CI (`ci.yml`). Re-run after Phase 7's new `event/*` routes were added to `app/_layout.tsx` and after Phase 6.1's deployment-focused audit — both platforms export cleanly, `expo-doctor` 21/21. No new native dependency was added in either phase, so a full native rebuild (`pod-install`/`expo run:ios`) was not required — the bundle export is the applicable check. |
| E2E                     | Maestro 2.10.0, user-scoped install, against the iOS Simulator                                | Full user flows: personal task smoke (sign in, quick-add, schedule, complete, restore), shared family task workflow (create unassigned → sign out → other member takes and completes), assignment decline (assign → decline → assigner sees the update after a fresh sign-in)                                                                                                                                                                                                                                                                            | **Implemented for Phases 4–5's flows only.** Each verified with two consecutive fully clean, unattended runs, cross-checked against real database state after each run — see DECISIONS.md, "Phase 5," for the full environment-issue writeup. Push notifications (Phase 6), the family calendar (Phase 7), and deployment validation (Phase 6.1) are **not** covered by Maestro — see docs/DECISIONS.md, "Phase 6," "Phase 7," and "Phase 6.1," for why (no real device/EAS build in this loop for push notifications and deployment; the established Maestro non-determinism plus the calendar phase's already-large scope for that phase, deliberately not risking a rushed/flaky addition) — `scripts/e2e-notifications.sh`/`e2e-calendar.sh` are the real-backend coverage that exists instead for each. **Phase 9**: no new Maestro flow added — the existing `personal_task_smoke.yaml` was re-run as a regression check (passed clean) on a real `expo run:ios` debug build, which also directly confirmed the sync-status indicator, a live Realtime-driven Conflict Center update from an external mutation, and the conflict badge, all on-device — see docs/DECISIONS.md, "Phase 9," "Native iOS verification" and "Maestro policy for Phase 9," for the full evidence and for why network-disconnection scenarios specifically were deferred to the deterministic `e2e:offline` suite instead of Maestro. |

## Why RLS gets its own layer instead of being "covered by app tests"

Privacy in this product is a database-enforced guarantee (see SECURITY_AND_PRIVACY.md,
Mechanisms 1–2), not a UI behavior. A component test can prove the _UI_ never renders a
private title; it cannot prove the _API response_ never contained one. Only a test that
issues real queries against a real RLS-enabled Postgres instance, authenticated as a
non-owner, can prove that. Mocking Supabase for this class of test would test the mock, not
the guarantee — so these tests run against a real local Postgres (`supabase test db`), never
a stub client.

## RLS test-writing conventions (supabase/tests/)

- **Fixtures are inserted directly as `postgres`** (bypasses RLS, and — for `auth.users`
  rows — exercises the real `handle_new_auth_user` profile-creation trigger). Never seed
  fixtures through a simulated authenticated role; RLS should only be turned on for the
  actual assertions.
- **Simulating a specific user**: `set local role authenticated;` then
  `select set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role',
'authenticated')::text, true);` — this is what Supabase's local Postgres's `auth.uid()`/
  `auth.jwt()` read from (confirmed against the real function definitions, not assumed).
  `reset role;` returns to `postgres` before switching to the next persona. Anonymous is
  `set local role anon;` with `request.jwt.claims` cleared.
- **Expect exact Postgres error codes** with `throws_ok(sql, '<sqlstate>', null, description)`
  — `23503` foreign_key_violation, `23505` unique_violation, `23514` check_violation
  (including custom `raise exception ... using errcode = '23514'` triggers), `42501`
  insufficient_privilege (covers both "no GRANT at all" and "RLS WITH CHECK failed" — Postgres
  uses the same code for both).
- **The privacy regression pattern** (`060_privacy_regression_test.sql`): plant a unique
  per-run secret string (`'SECRET-MARKER-' || substr(gen_random_uuid()::text, 1, 8)`) in
  every sensitive column of a private row, then assert it is absent — not just that the field
  is `null`, but that no query result anywhere contains the literal string — from every
  non-owner angle (family member via the sanitized view, outsider, anonymous). A `null`-only
  assertion wouldn't catch a future migration that adds a new sensitive column and forgets to
  sanitize it in the view; the string-absence sweep would.

## Conventions established in this foundation phase

- **`render()` and `fireEvent.*()` are async in the installed RNTL version — always
  `await` them.** (See DECISIONS.md.) A test that doesn't will either produce a floating-promise
  lint error or, worse, assert before the render/interaction actually completed.
- **Validation schemas (`src/domain/*/schemas.ts`) carry no translated strings** — Zod
  `message` values are internal-only tokens (`'title_required'`, etc.); components map them to
  translated text. This means a schema is testable (and was designed to be testable) without
  any i18n setup in the test at all.
- **Domain logic stays free of React and I/O** so it can be tested as plain functions
  (`priority.ts` is the template to follow — no hooks, no Supabase calls, no `AsyncStorage`).
- **Components that need theme context** (`useAppTheme()`) are rendered wrapped in
  `<AppThemeProvider>` in tests rather than mocking the hook — see `EmptyState.test.tsx`. This
  catches real integration issues (missing theme tokens, provider ordering) that mocking would
  hide.
- **Modules with load-time side effects** (`env.ts` computes `env` eagerly at import time) are
  tested by `jest.resetModules()` + `require()` (not `import()` — this Babel/CJS Jest setup
  can't resolve a throwing dynamic `import()` to a rejected promise) inside each test case, to
  exercise different `process.env` configurations. See `src/lib/env.test.ts`.
- **Firing an external event handler captured via a mock** (e.g. Supabase's
  `onAuthStateChange` callback) must be wrapped in `act()` from
  `@testing-library/react-native` — see `src/lib/auth/AuthProvider.test.tsx`.
- Jest's `transformIgnorePatterns` is left to the `jest-expo` preset rather than
  hand-maintained — see DECISIONS.md for why a hand-written version broke.
- **`renderHook` from `@testing-library/react-native@14` is `async` — `await` the call
  itself**, not just the interactions inside `waitFor`. Destructuring `{ result }` from the
  unawaited call silently gets `result: undefined` (confirmed from the shipped source, not
  guessed) rather than a helpful error — see `src/domain/family/hooks.test.tsx`.
- **Mock a service module with an explicit factory, not bare `jest.mock('path')`
  (automock), when the real module has a native-module side effect at import time.**
  Automocking still evaluates the real module once to infer its exported shape; if that
  module (transitively) imports `@/lib/supabase/client`, which imports
  `@react-native-async-storage/async-storage`, the suite fails with `NativeModule:
AsyncStorage is null` even though every call is mocked. Listing the exports explicitly in
  the factory (`jest.mock('@/lib/family/familyService', () => ({ listMyFamilies: jest.fn(),
... }))`) never touches the real module at all — see `src/domain/family/hooks.test.tsx`.
- **`process.env.TZ` reassignment at runtime is not reliably honored inside this project's
  `jest-expo` test environment**, even though it is in plain Node (confirmed via `node -e`).
  Write timezone-dependent domain code so it never needs to read ambient timezone state in the
  first place — take "now" as an explicit `Date` built via the local constructor, as
  `src/domain/tasks/dateUtils.ts` does — rather than relying on a test being able to swap the
  system timezone out from under it. See `src/domain/tasks/dateUtils.test.ts` and
  `docs/DECISIONS.md`, "Phase 4."
- **`renderHook` + an imperative call to a returned function (e.g. `result.current.mutate(...)`)
  should be wrapped in `act(async () => { ... })`** from `@testing-library/react-native` — an
  unwrapped call can leave a state update unflushed for `waitFor` to observe. See
  `src/domain/tasks/hooks.test.tsx`.
- **`act(() => { ... })` (the synchronous form) after an `await renderHook(...)` can corrupt
  React's internal act-scope for the *next* test's `renderHook` call in the same file** —
  observed as a mysteriously-empty mock call history (`addNotificationResponseReceivedListener`
  showing 0 calls) on every test *after* the one that used a bare `act()`, even though that
  later test's own `renderHook` looked completely normal in isolation. Root-caused via a
  minimal two-test repro (isolated from the real suite) that reproduced the leak only when the
  first test's `act()` call wasn't awaited. Fix: always `await act(async () => { ... })`, even
  for a callback with no `await` inside it. `unmount()` from RNTL 14's `renderHook` result is
  also async and needs the same `await` — see `src/lib/notifications/notificationResponseRouter.test.ts`.
- **Mocking a plain boolean/data export that a test needs to mutate per-test (e.g.
  `expo-device`'s `isDevice`) needs a live getter, not a plain data property.** `jest.mock('expo-device',
  () => ({ isDevice: true }))` followed by `(Device as any).isDevice = false` in a test looks
  like it should work, but each file's own `import * as Device from 'expo-device'` gets its
  *own* ESM-interop-wrapped copy of that object (Babel's `_interopRequireWildcard` snapshots a
  plain data property's value at wrap time) — mutating the test file's copy never reaches the
  copy `notificationService.ts` itself reads, so the code under test silently keeps seeing the
  original value. Confirmed via an isolated repro comparing `import * as X` against a direct
  `require()` of the same mocked module. Fix: back the mocked property with a module-level
  `let` variable and expose it as a getter (`get isDevice() { return mockIsDevice; }`) — a
  getter descriptor survives the interop copy as a live accessor, not a snapshotted value. See
  `src/lib/notifications/notificationService.test.ts`.
- **A slow-to-report `renderHook`/mutation test that appears to hang is usually not actually
  hung** — this project's background test runs have repeatedly shown a test suite finish in
  under a second internally, then take much longer to report completion in a piped/backgrounded
  shell, printing Jest's own "did not exit one second after the test run" warning. Check the
  suite's own pass/fail summary in the output before assuming a real deadlock; only chase it as
  a genuine bug if the summary itself never appears. **Phase 5 root-caused the specific,
  reproducible version of this for single-file invocations**: it's a real crash-on-teardown
  race between React 19's deferred `act()` flush (a `setImmediate` callback) and Jest's
  per-file module-registry teardown, triggered by `react-native-paper` components that lazily
  construct an `Animated.Value` (e.g. `TextInput`) — see `docs/DECISIONS.md`, "Phase 5, known
  technical debt," for the full bisection and evidence. `--detectOpenHandles` does not surface
  it (it's a scheduled callback, not a tracked timer/socket handle). The full suite (`npm test`)
  is unaffected and is the authoritative check; never add `--forceExit` to it or to CI.

- **A screen's own test file must never live inside `app/`, even co-located next to the
  screen it tests (Phase 7 follow-up).** Expo Router's Metro bundler treats every file under
  `app/` as a route candidate regardless of filename — a `.test.tsx` there is no exception.
  `app/(app)/calendar.test.tsx` built and passed under Jest, but broke `npx expo export
  --platform ios` outright: Metro tried to bundle `@testing-library/react-native` into the
  real production app and failed on an unresolvable `console` import inside the testing
  library itself. This is why no other screen in this codebase has a test file — not an
  oversight. Fixed by moving the test to `src/components/calendar/CalendarScreen.test.tsx`,
  importing the screen component via a relative path
  (`../../../app/(app)/calendar`) — Jest doesn't use Metro's bundler, so a `src/` test
  importing an `app/` file is fine at test time and invisible to the production bundle. Any
  future screen-level test should follow this same location, not `app/` itself.

- **`react-native-paper`'s `<Menu>` limitation is not Jest-only (Phase 8).** Phase 5 documented
  it as unreliable under `react-test-renderer`; Phase 8's live Maestro-driven simulator testing
  reproduced the identical failure in a real running app — six distinct tap strategies against
  the anchor button all reported success in Maestro's own output, but a `maestro hierarchy` dump
  taken immediately after showed zero menu content mounted anywhere, and a frame-by-frame
  extraction of a screen recording showed the button's own pressed-state highlight firing
  correctly with no menu content in any frame. The same failure reproduced on a second,
  independent `<Menu>` on the same screen, narrowing it to "any `<Menu>` whose anchor lives on a
  screen presented via `presentation: 'modal'`," not a component-specific bug — see
  [DECISIONS.md, "Phase 8"](DECISIONS.md) for the full evidence. **Consequence for test-writing**:
  do not attempt to drive a `<Menu>` open in either a Jest test or a Maestro flow on a modal
  screen; test the pure logic behind it directly instead (Phase 8's
  `ReminderEditorSection.test.tsx` extracts `existingReminderOffsets()` as a standalone,
  Menu-free unit for exactly this reason, after the Menu-driven version of that same test proved
  flaky under a full-suite run — passing in isolation, intermittently failing at suite scale).

- **When a UI-automation limitation blocks a required on-device check, a temporary `__DEV__`-only
  diagnostic screen calling the real production functions is an accepted workaround — not a
  shortcut (Phase 8's final validation pass).** The `<Menu>` limitation above blocked granting
  notification permission and triggering reconciliation through the normal UI. Rather than
  report that verification as impossible, `app/dev-diagnostics.tsx` (gated by `if (!__DEV__)
  return null`, registered in `app/_layout.tsx` only when `__DEV__`, reachable only via a direct
  deep link — absent from any production build and from normal in-app navigation) called the
  exact production functions a real user action would (`requestNotificationPermission`,
  `reconcileReminders`, `expoLocalScheduler.listScheduled`) and displayed only ids/keys/times,
  never a task title. This let real on-device scheduling/delivery/reschedule/cancellation be
  directly observed — see [DECISIONS.md, "Phase 8"](DECISIONS.md) for the full evidence, which
  is preserved there as a record even though the diagnostic route no longer exists. The bar it
  had to clear while it existed: every button must call real production code (never a
  reimplementation or a mock), never bypass an actual business rule (only the broken *UI
  trigger* for an already-correct code path), and never render anything a production build
  would ship or a real user could reach.
  **`app/dev-diagnostics.tsx` and its route registration were removed before merge** (a
  dedicated production-surface cleanup pass, same session) — confirmed absent from both
  `expo export` platforms' route manifests and bundled JS, from `npx expo config`'s public
  output, and from every source reference reachable from a production build. The production
  functions it exercised (`requestNotificationPermission`, `reconcileReminders`,
  `expoLocalScheduler`, `useReminderNotificationActions`) are untouched — the diagnostic only
  ever called them, nothing in them depended on the diagnostic existing. If a future phase needs
  the same kind of on-device verification again, re-add a similarly scoped, similarly temporary
  screen rather than assuming this one still exists.
- **A test reading real wall-clock time (`new Date()`/`Date.now()`) with no fixed system clock
  is a real, if usually-invisible, source of flakiness — fix it with `jest.useFakeTimers().
  setSystemTime(...)`, don't just re-run it (Phase 8's final validation pass).** A
  `SNOOZE_TONIGHT`/`SNOOZE_TOMORROW` test that had passed throughout Phase 8 failed the first
  time this suite happened to run near midnight — not test flakiness but a real production bug
  the untested time-of-day exposed (see `useReminderNotificationActions.ts`'s Tonight/Tomorrow
  fix, [DECISIONS.md, "Phase 8"](DECISIONS.md)). Any test whose assertions depend on the
  relationship between "now" and a fixed clock time (a snooze anchor, a daily cutoff, etc.)
  should fix system time explicitly and add a case for the specific edge the fix addresses, not
  rely on incidentally passing at whatever time it happens to run.
- **RNTL's `act()` is async in this installed version too — an unawaited `act(() => {...})`
  leaves a dangling promise that can corrupt a *later, unrelated* test (Phase 9).** Found via
  a genuinely confusing symptom: `useRealtimeSync.test.tsx`'s "coalesces a burst of
  broadcasts" test failed only when run as part of the full suite, passing every time in
  isolation — proof of test-order/state leakage, not a hook-logic bug. Root cause: a
  preceding test called `act(() => {...})` with a synchronous callback but never `await`ed
  the call; the returned promise resolved asynchronously sometime *during* the next test's
  execution, interleaving state updates unpredictably. `render`/`fireEvent.*`/`renderHook`/
  `rerender`/`unmount` were already documented above as needing `await`; this extends the
  same rule to every bare `act()` call, sync callback or not — always `await act(async () =>
  {...})`, never a bare `act(() => {...})`.
- **A `react-hooks/refs` lint rule (Phase 9) now forbids writing to a ref's `.current` during
  render** — a pattern this codebase had used before (`someRef.current = () => {...}` inline
  in a hook body, to keep a callback's closure fresh without re-subscribing an effect). Fixed
  by moving the write into a dependency-less `useEffect` (runs after every commit, never
  during render) instead of deleting the pattern — the underlying "keep this closure fresh
  every render" need is still real and still needed a ref that also survives across renders.

## What "at least one test of each kind" means going forward

Every new domain module should ship with a unit test in the same PR (not after). Every new
reusable component in `src/components/ui/` should ship with a component test covering its
observable states (empty, with content, with an action). Every new i18n namespace added to
`src/i18n/index.ts` should be covered by the existing key-parity check in `i18n.test.ts`
(no new test file needed — that test already iterates all registered namespaces). Every new
exposed database table needs RLS policies **and** a pgTAP test file proving the allow/deny
matrix for at least the owner, one in-family, and one outsider persona.

## Running tests

```bash
npm run test         # jest
npm run test:watch   # jest --watch
npm run db:test       # supabase test db — pgTAP, needs the local stack running
```

CI additionally runs `npm run test -- --ci --coverage` and (where Docker is available)
`supabase db reset && supabase test db` — see `.github/workflows/ci.yml`.
