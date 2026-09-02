---
title: Testing strategy
status: current
updated: 2026-09-02
sources:
  - ../../../docs/TEST_STRATEGY.md
tags: [engineering, testing]
---

## Confirmed / current

- **Domain logic** (`src/domain/**`) — plain Jest, no React/I/O. Existing:
  `src/domain/tasks/priority.test.ts`.
- **Components** — Jest + React Native Testing Library, rendered wrapped in
  `<AppThemeProvider>` (not mocked). Existing: `src/components/ui/EmptyState.test.tsx`.
- **Localization** — `src/i18n/i18n.test.ts` checks i18next initializes, a key translates
  differently per locale, and every namespace has matching keys across `en`/`uk`.
- **Build/bundle smoke test** — `npx expo export --platform ios|android`, `npx expo config`,
  `npx expo-doctor`; catches what lint/typecheck can't (see the `expo-router` vs.
  `@react-navigation/native` case in [system-architecture](system-architecture.md)). Wired
  into `.github/workflows/ci.yml`.

## Not yet implemented

- **RLS/privacy tests** — needs a real Postgres instance with RLS enabled (pgTAP or
  Supabase's local-stack test runner); can't exist until the first migration does. Flagged
  as the **highest-priority addition** the moment migrations start — a correctness
  requirement for [privacy-and-availability](../domain/privacy-and-availability.md), not a
  nice-to-have.
- **E2E (Maestro)** — explicitly future work per the brief; no flow exists yet worth
  E2E-testing.

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

## Running

```bash
npm run test        # jest
npm run wiki:lint    # validates this wiki's structure
npm run verify       # lint + typecheck + test + wiki:lint
```

## See also

- [Security model](security-model.md) — why RLS tests can't be mocked
- [Development workflow](development-workflow.md) — CI wiring
