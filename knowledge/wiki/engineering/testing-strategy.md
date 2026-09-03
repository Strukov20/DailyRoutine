---
title: Testing strategy
status: current
updated: 2026-09-03
sources:
  - ../../../docs/TEST_STRATEGY.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-02-phase2-docker-resolved.md
  - ../../raw/sessions/2026-09-03-phase3-family-space.md
  - ../../raw/sessions/2026-09-03-phase4-personal-tasks.md
  - ../../raw/sessions/2026-09-05-phase5-shared-family-tasks.md
tags: [engineering, testing]
---

## Confirmed / current

- **Domain logic** (`src/domain/**`) — plain Jest, no React/I/O.
  `src/domain/tasks/{priority,schemas,mappers,dateUtils,sections,errorMessages}.test.ts`,
  `src/domain/auth/errorMessages.test.ts`, `src/domain/family/{errorMessages,mappers}.test.ts`,
  `src/domain/categories/mappers.test.ts`. `dateUtils.test.ts` is the one with the most at
  stake — deterministic coverage for UTC/Europe-Kyiv/negative-offset/DST/midnight-boundary
  cases, per this phase's brief; see "A real Jest/TZ quirk" below.
- **Components** — Jest + React Native Testing Library, rendered wrapped in
  `<AppThemeProvider>` (not mocked). `src/components/ui/EmptyState.test.tsx`,
  `src/components/tasks/{TaskRow,QuickAddInput}.test.tsx` (accessibility state, double-submit
  and duplicate-tap prevention). **Phase 5** adds
  `src/components/tasks/{AssigneeLabel,AssigneePicker,FamilyTaskRow,FamilyTaskBoard}.test.tsx`
  — 172 Jest tests total across 28 suites, up from 144. Two RN Testing Library environment
  limits found and worked around here, not in production code:
  - **`react-native-paper`'s `<Menu>` never mounts its Portal content under
    `react-test-renderer`** (no native layout engine to satisfy its internal
    `measureInWindow`-driven `rendered` state) — confirmed a hard cutoff, not a slow render,
    via direct experiment. `AssigneePicker.test.tsx` is scoped to what's reliably observable
    (the trigger button and its `disabled` state) rather than asserting on opened-menu
    content; no other component in this codebase drives a `Menu` open in tests either.
  - **`SectionList` (`VirtualizedList`) never expands its render window past the initial
    batch** under the same missing-layout-engine constraint — `FamilyTaskBoard.test.tsx`
    mocks `react-native/Libraries/Lists/SectionList` to render every row unconditionally
    rather than bumping a production `initialNumToRender` (tried and reverted — it only
    existed to satisfy Jest). Full evidence and reasoning:
    [DECISIONS.md, "Phase 5"](../../../docs/DECISIONS.md).
- **Localization** — `src/i18n/i18n.test.ts` checks i18next initializes, a key translates
  differently per locale, and every namespace has matching keys across `en`/`uk`.
- **Auth/config** — Jest with `@/lib/supabase/client`/`@/lib/env` mocked at the module
  boundary. `src/lib/env.test.ts`, `src/lib/auth/authService.test.ts`,
  `src/lib/auth/oauth.test.ts`, `src/lib/auth/AuthProvider.test.tsx`.
- **Repositories/services and selection hooks** (Phase 3 pattern, confirmed again in Phase 4)
  — `src/lib/{family,tasks,categories}/*Service.test.ts` mock `@/lib/supabase/client`'s
  `.from()`/`.rpc()` chains to test row-mapping and SQLSTATE normalization;
  `src/domain/{family,tasks}/hooks.test.tsx` use RNTL's `renderHook` (which is `async` — must
  be awaited, unlike `render`/`fireEvent` which merely _return_ promises) with a
  `QueryClientProvider` wrapper. `src/domain/tasks/hooks.test.tsx` specifically proves
  `useCompletePersonalTask`'s optimistic update rolls back **deterministically to the exact
  pre-mutation cache state** on a simulated server failure — the concrete test the
  optimistic-update architecture rule (see [system-architecture](system-architecture.md))
  requires before any hook is allowed to use one.
- **RLS/privacy tests** — pgTAP via `supabase test db`, against a real local Postgres
  instance with RLS enabled. `supabase/tests/*.sql` (10 files, 192 assertions through Phase 4
  - 71 more added in Phase 5's `100_shared_family_tasks_test.sql` = 263 total), including a
    dedicated secret-marker privacy-regression test (`060_privacy_regression_test.sql`), the
    full family/invitation/child-profile RPC suite (`080_family_management_test.sql`), the
    personal-task RPC suite (`090_personal_task_management_test.sql`, itself extending the
    secret-marker sweep to the new RPC-only task write path), and the shared-task assignment
    suite (`100_shared_family_tasks_test.sql`) — creation/outsider-rejection, the full
    assignment state machine, stale-acceptance-after-reassignment, Take Task concurrency proxy,
    completion permissions, member-removal resolution (both pending and accepted), and every new
    RPC's anon/authenticated privilege check.
    **Verified: all 192 assertions pass** against a real local instance (`supabase db reset &&
supabase test db`), plus real curl-driven multi-user flows for both Family Space and personal
    tasks (real `auth.users` accounts, not simulated `set local role`) — see
    [`knowledge/raw/sessions/2026-09-03-phase3-family-space.md`](../../raw/sessions/2026-09-03-phase3-family-space.md)
    and
    [`knowledge/raw/sessions/2026-09-03-phase4-personal-tasks.md`](../../raw/sessions/2026-09-03-phase4-personal-tasks.md).
    Running the Phase 2 suite for real surfaced and fixed one migration-ordering bug and two
    test-assertion bugs; the Phase 3 audit surfaced a real `anon`-EXECUTE-grant gap and the
    Phase 4 audit surfaced a real `tasks`-direct-`UPDATE` gap (see
    [security-model](security-model.md)) — none of these were caught by static review alone.
    CI's `database` job also runs them on every push/PR.
- **Build/bundle smoke test** — `npx expo export --platform ios|android`, `npx expo config`,
  `npx expo-doctor`; catches what lint/typecheck can't (see the `expo-router` vs.
  `@react-navigation/native` case in [system-architecture](system-architecture.md)). Wired
  into `.github/workflows/ci.yml`.

## Not yet implemented

- **E2E (Maestro)** — explicitly future work per the brief; the sign-in/sign-up flow now
  exists and would be the first realistic candidate once Maestro is set up.

## Conventions to follow in new tests

- **`render()` and `fireEvent.*()` are async in the installed RNTL version — always
  `await` them.** (See [`docs/DECISIONS.md`](../../../docs/DECISIONS.md).) Skipping this
  either trips `@typescript-eslint/no-floating-promises` or asserts before the
  render/interaction finished.
- Validation schemas (`src/domain/*/schemas.ts`) carry no translated strings — Zod `message`s
  are internal tokens; components map them to translated text. Keeps schemas testable
  without any i18n setup.
- Jest's `transformIgnorePatterns` is left to the `jest-expo` preset — don't hand-roll it
  (see `docs/DECISIONS.md` for the `standard-navigation` breakage this caused once already).
- **Modules with load-time side effects** (`env.ts` computes `env` eagerly at import) — test
  with `jest.resetModules()` + `require()` per case, not `import()` (this Babel/CJS Jest
  setup can't resolve a throwing dynamic `import()` to a rejected promise).
- **Firing a captured external callback** (e.g. Supabase's `onAuthStateChange` mock) must be
  wrapped in `act()` from `@testing-library/react-native`.
- **pgTAP fixtures** are inserted directly as `postgres` (bypasses RLS); a specific user is
  simulated via `set local role authenticated;` + `set_config('request.jwt.claims', ...)`;
  expect exact Postgres SQLSTATEs (`23503`/`23505`/`23514`/`42501`) with `throws_ok`. Full
  convention: [`docs/TEST_STRATEGY.md`, "RLS test-writing conventions"](../../../docs/TEST_STRATEGY.md).
- **A real Jest/TZ quirk (Phase 4)**: `process.env.TZ` reassignment at runtime changes
  `Date`'s local-time output in plain Node (confirmed) but is **not** reliably honored inside
  this project's `jest-expo` test environment. Write timezone-dependent code to take "now" as
  an explicit already-local `Date` (built via the local constructor) rather than reading
  ambient timezone state, and it won't matter either way — see
  `src/domain/tasks/dateUtils.ts`/`.test.ts`.
- **Wrap an imperative call on a `renderHook` result in `act(async () => {...})`** — e.g.
  `result.current.mutate(...)` — or a subsequent `waitFor` can fail to observe the state
  update. See `src/domain/tasks/hooks.test.tsx`.
- **A `renderHook`/mutation test that seems to hang in a piped or backgrounded shell often
  isn't** — this project has repeatedly seen a suite finish internally in well under a second,
  then take much longer to report completion, printing Jest's own "did not exit one second
  after the test run" warning. Check for the suite's actual pass/fail summary before assuming
  a real deadlock. **Phase 5 root-caused the specific single-file-invocation version of this**:
  it's a real crash-on-teardown race between React 19's deferred `act()` flush and Jest's
  per-file module-registry teardown, triggered by `react-native-paper` components that lazily
  construct an `Animated.Value`. `--detectOpenHandles` does not surface it. The full suite
  (`npm test`) is unaffected and is the authoritative check — never add `--forceExit` to it or
  to CI; a one-off manual `--forceExit` during ad hoc single-file debugging is fine. Full
  bisection and evidence: [DECISIONS.md, "Phase 5, known technical
  debt"](../../../docs/DECISIONS.md).

## Running

```bash
npm run test        # jest
npm run db:test      # pgTAP — needs the local Supabase stack running
npm run wiki:lint    # validates this wiki's structure
npm run verify       # lint + typecheck + test + wiki:lint
```

## See also

- [Security model](security-model.md) — why RLS tests can't be mocked
- [Authentication](authentication.md) — what the auth test suite covers
- [Development workflow](development-workflow.md) — CI wiring
