# Test Strategy

## Layers

| Layer                   | Tool                                                                                          | What it covers                                                                                                                                                                                                                                                                                                                                           | Status                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain logic            | Jest                                                                                          | Pure functions in `src/domain/**` — priority ordering, validation schemas, auth error-code mapping                                                                                                                                                                                                                                                       | `src/domain/tasks/priority.test.ts`, `src/domain/auth/errorMessages.test.ts`                                                                                                                                                                                                                                                                                                                                               |
| Components              | Jest + React Native Testing Library                                                           | Reusable UI primitives (`src/components/ui/**`) rendered and interacted with                                                                                                                                                                                                                                                                             | `src/components/ui/EmptyState.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                    |
| Localization            | Jest                                                                                          | i18next initializes correctly; every namespace has matching keys across `en`/`uk`; a given key actually translates differently per locale                                                                                                                                                                                                                | `src/i18n/i18n.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                    |
| Auth / config           | Jest, with `@/lib/supabase/client` and `@/lib/env` mocked at the module boundary              | Missing Supabase configuration, localized error mapping, unavailable OAuth provider configuration, session loading/signed-in/signed-out routing                                                                                                                                                                                                          | `src/lib/env.test.ts`, `src/lib/auth/authService.test.ts`, `src/lib/auth/oauth.test.ts`, `src/lib/auth/AuthProvider.test.tsx`                                                                                                                                                                                                                                                                                              |
| RLS / privacy           | pgTAP via `supabase test db`, against a real local Postgres instance with RLS enabled         | Non-owner cannot read a private row's sensitive columns via the base table or the sanitized view; the required personas (owner, adult member, outsider, different-family adult, unlinked child, anonymous) each get the correct allow/deny outcome per table; the "Event ≠ Responsibility" worked example; append-only enforcement on `task_assignments` | **Implemented and verified** — `supabase/tests/*.sql` (7 files: profiles, families/members, categories, tasks/assignments, events/responsibilities, a dedicated `060_privacy_regression_test.sql` secret-marker test, and reminders/notifications/locked-tables). All 88 assertions pass against a real local instance (`supabase db reset && supabase test db`) — see docs/DECISIONS.md, "Docker installed via Homebrew." |
| Build/bundle smoke test | `npx expo export --platform ios` / `--platform android`, `npx expo config`, `npx expo-doctor` | Catches the class of failure lint/typecheck cannot (see DECISIONS.md's `expo-router`/`@react-navigation/native` entry)                                                                                                                                                                                                                                   | Run manually every phase so far; wired into CI (`ci.yml`)                                                                                                                                                                                                                                                                                                                                                                  |
| E2E                     | Maestro                                                                                       | Full user flows (sign-in, create family, assign task, etc.)                                                                                                                                                                                                                                                                                              | **Not configured yet** — explicitly future work per the brief ("Maestro for future mobile E2E tests"); the sign-in/sign-up flow now exists and would be the first realistic candidate                                                                                                                                                                                                                                      |

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
