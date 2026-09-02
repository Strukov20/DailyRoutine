---
title: System architecture
status: current
updated: 2026-09-02
sources:
  - ../../../docs/ARCHITECTURE.md
  - ../../../docs/DECISIONS.md
tags: [engineering, architecture]
---

## Confirmed

Stack: Expo SDK 57 (managed) + Expo Router, TypeScript strict, Supabase (real schema + RLS
implemented locally as of Phase 2 — see [data-model](data-model.md); no hosted project
connected), TanStack Query for all server state, Zustand for a couple of client-only UI
fields, an `AuthProvider` context for session state (its own category — see below), React
Hook Form + Zod, React Native Paper (MD3) themed via `src/theme/`, Expo Notifications,
i18next/react-i18next + expo-localization (en/uk), `jest-expo` + React Native Testing
Library. Full version table + rationale: [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md)
and [`docs/DECISIONS.md`](../../../docs/DECISIONS.md).

**State boundary rule** (the thing most likely to erode if not checked): anything with a
server owner is TanStack Query; Zustand (`src/store/uiStore.ts`) holds only
`colorSchemeOverride` and `activeFamilyId`; auth session state lives in its own
`AuthProvider` context (`src/lib/auth/AuthProvider.tsx`) — it doesn't fit Query (its source
of truth is the Supabase SDK's own session state, not a request/response cache) or Zustand
(nearly every screen depends on it for routing, not presentation). If a future addition to
the Zustand store needs to survive a backend round-trip or be visible cross-device, it
belongs in a query/mutation instead — it has drifted out of scope for that store.

**Provider stack** (`app/_layout.tsx`): `GestureHandlerRootView` → `SafeAreaProvider` →
`AppThemeProvider` → `QueryProvider` → `AuthProvider` → `ErrorBoundary` → Expo Router `Stack`
(gated by `Stack.Protected` — see [authentication](authentication.md)). `initI18n()` runs
synchronously at module scope before first render (resources are bundled, not fetched).

## Decision worth re-surfacing: navigation theming imports from `expo-router`

`ThemeProvider`/`DefaultTheme`/`DarkTheme` come from `expo-router` /
`expo-router/react-navigation`, **not** `@react-navigation/native` — the direct import passes
lint/typecheck but fails at Metro bundle time under Expo Router 6+ ("no longer compatible
with react-navigation"). Found via `npx expo export --platform ios`, not static analysis —
that command is now part of CI and worth re-running after any navigation/theming change, not
just trusting lint+typecheck. Full story:
[`docs/DECISIONS.md`](../../../docs/DECISIONS.md).

## Environment config

`app.config.ts` (not `app.json`) reads `src/config/app-info.json` (plain JSON, not `.ts` —
`app.config.ts`'s loader can't resolve sibling TS modules). `src/lib/env.ts` Zod-validates
`EXPO_PUBLIC_*` at startup; a missing/malformed var fails loudly immediately, not deep inside
a later Supabase call. Also validates the OAuth config-gate flags — see
[authentication](authentication.md).

## See also

- [Data model](data-model.md)
- [Security model](security-model.md)
- [Authentication](authentication.md)
- [Development workflow](development-workflow.md)
