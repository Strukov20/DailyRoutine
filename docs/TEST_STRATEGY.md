# Test Strategy

## Layers

| Layer                   | Tool                                                                                          | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain logic            | Jest                                                                                          | Pure functions in `src/domain/**` — priority ordering, validation schemas, auth/family/task error-code mapping, row-to-domain mappers' fallback narrowing, date-only utilities (UTC/Kyiv/negative-offset/DST/midnight-boundary determinism — see DECISIONS.md, "Phase 4"), Today/Tomorrow section-bucketing and sorting                                                                                                                                                                                                                                                                                                                                  | `src/domain/tasks/{priority,schemas,mappers,dateUtils,sections,errorMessages}.test.ts`, `src/domain/auth/errorMessages.test.ts`, `src/domain/family/{errorMessages,mappers}.test.ts`, `src/domain/categories/mappers.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Components              | Jest + React Native Testing Library                                                           | Reusable UI primitives (`src/components/ui/**`) and feature components (`src/components/tasks/**`) rendered and interacted with — accessibility state (`accessibilityState.checked`, not color alone), double-submit/duplicate-tap prevention                                                                                                                                                                                                                                                                                                                                                                                                            | `src/components/ui/EmptyState.test.tsx`, `src/components/tasks/{TaskRow,QuickAddInput}.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Repositories / services | Jest, with `@/lib/supabase/client` mocked at the module boundary                              | Every `<feature>Service.ts`'s row-mapping and SQLSTATE → typed-error-code normalization (see ARCHITECTURE.md, "Layering")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/lib/family/familyService.test.ts`, `src/lib/tasks/taskService.test.ts`, `src/lib/categories/categoryService.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Query/selection hooks   | Jest + RNTL's `renderHook`, with the service module mocked                                    | Non-trivial hook logic beyond thin TanStack Query wiring — `useActiveFamily()`'s fallback-to-first-family selection; `useCompletePersonalTask`'s optimistic update **and its deterministic rollback on a simulated server failure** (see ARCHITECTURE.md, "Optimistic updates are the exception")                                                                                                                                                                                                                                                                                                                                                        | `src/domain/family/hooks.test.tsx`, `src/domain/tasks/hooks.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Localization            | Jest                                                                                          | i18next initializes correctly; every namespace has matching keys across `en`/`uk`; a given key actually translates differently per locale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `src/i18n/i18n.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Auth / config           | Jest, with `@/lib/supabase/client` and `@/lib/env` mocked at the module boundary              | Missing Supabase configuration, localized error mapping, unavailable OAuth provider configuration, session loading/signed-in/signed-out routing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `src/lib/env.test.ts`, `src/lib/auth/authService.test.ts`, `src/lib/auth/oauth.test.ts`, `src/lib/auth/AuthProvider.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| RLS / privacy           | pgTAP via `supabase test db`, against a real local Postgres instance with RLS enabled         | Non-owner cannot read a private row's sensitive columns via the base table or the sanitized view; the required personas (owner, adult member, outsider, different-family adult, unlinked child, anonymous) each get the correct allow/deny outcome per table; the "Event ≠ Responsibility" worked example; append-only enforcement on `task_assignments`; every family/invitation/child-profile/personal-task RPC's permission and validity checks, and that `anon` truly has no `EXECUTE` on any of them (see DECISIONS.md, "Phase 3," for why this needed a dedicated real-instance check rather than trusting the migration's own `revoke` statement) | **Implemented and verified** — `supabase/tests/*.sql` (9 files: profiles, families/members, categories, tasks/assignments, events/responsibilities, a dedicated `060_privacy_regression_test.sql` secret-marker test, reminders/notifications/locked-tables, `080_family_management_test.sql`, and `090_personal_task_management_test.sql`). All 192 assertions pass against a real local instance (`supabase db reset && supabase test db`), plus real curl-driven multi-user flows for both Family Space and personal tasks (owner/member/outsider, real `auth.users` accounts) — see docs/DECISIONS.md, "Docker installed via Homebrew," and the Phase 3/4 final reports. |
| Build/bundle smoke test | `npx expo export --platform ios` / `--platform android`, `npx expo config`, `npx expo-doctor` | Catches the class of failure lint/typecheck cannot (see DECISIONS.md's `expo-router`/`@react-navigation/native` entry)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Run manually every phase so far; wired into CI (`ci.yml`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| E2E                     | Maestro 2.10.0, user-scoped install, against the iOS Simulator                                | Full user flows: personal task smoke (sign in, quick-add, schedule, complete, restore), shared family task workflow (create unassigned → sign out → other member takes and completes), assignment decline (assign → decline → assigner sees the update after a fresh sign-in)                                                                                                                                                                                                                                                                                                                                                                            | **Implemented** — `.maestro/{personal_task_smoke,family_task_workflow,assignment_decline}.yaml`, run via `npm run e2e:seed` then `npm run e2e:ios`. Each flow verified with two consecutive fully clean, unattended runs, cross-checked against real database state after each run. Full writeup of environment issues worked around (password text-injection, merged accessibility text, unmatchable boundary tab bar items, an unreliable `checked` selector, and a real app bug found and fixed) — see DECISIONS.md, "Phase 5."                                                                                                                                           |

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
