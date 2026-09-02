---
title: Testing strategy
status: current
updated: 2026-09-02
sources:
  - ../../../docs/TEST_STRATEGY.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
  - ../../raw/sessions/2026-09-02-phase2-docker-resolved.md
tags: [engineering, testing]
---

## Confirmed / current

- **Domain logic** (`src/domain/**`) — plain Jest, no React/I/O.
  `src/domain/tasks/priority.test.ts`, `src/domain/auth/errorMessages.test.ts`.
- **Components** — Jest + React Native Testing Library, rendered wrapped in
  `<AppThemeProvider>` (not mocked). `src/components/ui/EmptyState.test.tsx`.
- **Localization** — `src/i18n/i18n.test.ts` checks i18next initializes, a key translates
  differently per locale, and every namespace has matching keys across `en`/`uk`.
- **Auth/config** — Jest with `@/lib/supabase/client`/`@/lib/env` mocked at the module
  boundary. `src/lib/env.test.ts`, `src/lib/auth/authService.test.ts`,
  `src/lib/auth/oauth.test.ts`, `src/lib/auth/AuthProvider.test.tsx`.
- **RLS/privacy tests** — pgTAP via `supabase test db`, against a real local Postgres
  instance with RLS enabled. `supabase/tests/*.sql` (7 files, 88 assertions), including a
  dedicated secret-marker privacy-regression test (`060_privacy_regression_test.sql`).
  **Verified: all 88 assertions pass** against a real local instance (`supabase db reset &&
supabase test db`) — see
  [`knowledge/raw/sessions/2026-09-02-phase2-docker-resolved.md`](../../raw/sessions/2026-09-02-phase2-docker-resolved.md).
  Running these for real surfaced and fixed one migration-ordering bug and two test-assertion
  bugs, none of them RLS/privacy design flaws — see [DECISIONS.md](../../../docs/DECISIONS.md).
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
