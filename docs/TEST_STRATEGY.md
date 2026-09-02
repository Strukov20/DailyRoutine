# Test Strategy

## Layers

| Layer                   | Tool                                                                                           | What it covers                                                                                                                                                                                | Status                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain logic            | Jest                                                                                           | Pure functions in `src/domain/**` — priority ordering, validation schemas                                                                                                                     | `src/domain/tasks/priority.test.ts` exists                                                                                                                                                      |
| Components              | Jest + React Native Testing Library                                                            | Reusable UI primitives (`src/components/ui/**`) rendered and interacted with                                                                                                                  | `src/components/ui/EmptyState.test.tsx` exists                                                                                                                                                  |
| Localization            | Jest                                                                                           | i18next initializes correctly; every namespace has matching keys across `en`/`uk`; a given key actually translates differently per locale                                                     | `src/i18n/i18n.test.ts` exists                                                                                                                                                                  |
| RLS / privacy           | pgTAP or Supabase's local-stack test runner, against a real Postgres instance with RLS enabled | Non-owner cannot read a private row's sensitive columns via the base table, the sanitized view, or a simulated realtime subscription (see [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)) | **Not yet implemented — no migrations exist yet.** This is the highest-priority test category to add the moment the first migration lands; it is a correctness requirement, not a nice-to-have. |
| Build/bundle smoke test | `npx expo export --platform ios` / `--platform android`, `npx expo config`, `npx expo-doctor`  | Catches the class of failure lint/typecheck cannot (see DECISIONS.md's `expo-router`/`@react-navigation/native` entry)                                                                        | Run manually during this foundation phase; wired into CI (`ci.yml`)                                                                                                                             |
| E2E                     | Maestro                                                                                        | Full user flows (sign-in, create family, assign task, etc.)                                                                                                                                   | **Not configured yet** — explicitly future work per the brief ("Maestro for future mobile E2E tests"); no flow exists yet worth E2E-testing                                                     |

## Why RLS gets its own layer instead of being "covered by app tests"

Privacy in this product is a database-enforced guarantee (see SECURITY_AND_PRIVACY.md,
Mechanisms 1–3), not a UI behavior. A component test can prove the _UI_ never renders a
private title; it cannot prove the _API response_ never contained one. Only a test that
issues real queries against a real RLS-enabled Postgres instance, authenticated as a
non-owner, can prove that. Mocking Supabase for this class of test would test the mock, not
the guarantee — so these tests must run against a real (local Supabase CLI or CI-provisioned)
Postgres, not a stub client.

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
- Jest's `transformIgnorePatterns` is left to the `jest-expo` preset rather than
  hand-maintained — see DECISIONS.md for why a hand-written version broke.

## What "at least one test of each kind" means going forward

Every new domain module should ship with a unit test in the same PR (not after). Every new
reusable component in `src/components/ui/` should ship with a component test covering its
observable states (empty, with content, with an action). Every new i18n namespace added to
`src/i18n/index.ts` should be covered by the existing key-parity check in `i18n.test.ts`
(no new test file needed — that test already iterates all registered namespaces).

## Running tests

```bash
npm run test         # jest
npm run test:watch   # jest --watch
```

CI additionally runs `npm run test -- --ci --coverage` (see `.github/workflows/ci.yml`).
