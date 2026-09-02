# Architecture

## Stack

| Concern         | Choice                                                         | Version pinned                                    |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Framework       | React Native (via Expo)                                        | RN 0.86.3                                         |
| Toolchain       | Expo SDK                                                       | 57                                                |
| Routing         | Expo Router (file-based, on top of React Navigation internals) | ~57.0.18                                          |
| Language        | TypeScript, `strict: true` + extra strictness flags            | 6.0.3 (pinned — see [DECISIONS.md](DECISIONS.md)) |
| Backend         | Supabase (Postgres, Auth, Realtime, Storage)                   | client 2.113.0                                    |
| Server-state    | TanStack Query                                                 | 5.102.8                                           |
| Client UI-state | Zustand (small, deliberately scoped — see below)               | 5.0.15                                            |
| Forms           | React Hook Form + Zod (`@hookform/resolvers`)                  | 7.87.0 / 4.5.4                                    |
| UI kit          | React Native Paper (Material 3), themed via `src/theme/`       | 5.15.3                                            |
| Notifications   | Expo Notifications                                             | 57.0.16                                           |
| Localization    | expo-localization + i18next/react-i18next                      | see `src/i18n`                                    |
| Testing         | Jest (`jest-expo` preset) + React Native Testing Library       | 29.x / 14.0.1                                     |
| E2E (future)    | Maestro                                                        | not yet configured                                |
| Lint/Format     | ESLint (flat config) + Prettier                                | ESLint 9.39.5 (pinned) / Prettier 3.9.6           |
| CI              | GitHub Actions                                                 | `.github/workflows/ci.yml`                        |

Full version-selection rationale (including two deliberate downgrades from "latest") is in
[DECISIONS.md](DECISIONS.md).

## Folder structure

```text
app/                      Expo Router routes (file-based)
  _layout.tsx              Root: providers, i18n init, auth-gated Stack.Protected
  index.tsx                Redirects based on real auth status
  onboarding.tsx            First-run screen
  reset-password.tsx        Top-level (unguarded) — password recovery deep-link target
  auth-callback.tsx         Top-level (unguarded) — OAuth deep-link safety net
  (auth)/                   Reachable only when signed out
    sign-in.tsx / sign-up.tsx / forgot-password.tsx
    confirm.tsx              Email-confirmation deep-link target
  (app)/                    Reachable only when signed in
    _layout.tsx              Tabs: Today, Calendar, Inbox, Family, Profile
    today.tsx / calendar.tsx / inbox.tsx / family.tsx / profile.tsx
  task/
    new.tsx                 Modal: create-task preview (title-only, not persisted)
  +not-found.tsx

src/
  components/
    ui/                      Reusable primitives: ScreenContainer, EmptyState,
                              LoadingState, ErrorState
    ErrorBoundary.tsx
  config/
    app-info.json            Single source of truth for product name/slug/scheme
    appInfo.ts                Typed re-export of app-info.json for app code
  domain/                    Pure logic — no React, no I/O, unit-testable in isolation
    tasks/ (priority.ts, schemas.ts)
    auth/ (schemas.ts, errorMessages.ts)
    profile/ (types.ts, mappers.ts) — domain Profile, decoupled from the DB row shape
  i18n/                      i18next setup + locales/{en,uk}/*.json
  lib/
    env.ts                    Zod-validated environment access
    logger/logger.ts          Structured logging abstraction
    supabase/client.ts         Supabase client (AsyncStorage-backed session)
    supabase/types.ts          Database types (hand-authored — see file header)
    supabase/authRedirect.ts    Deep-link URL builder for auth flows
    auth/authService.ts         The only module that calls supabase.auth.*
    auth/AuthProvider.tsx        App-wide session state + useAuth()
    auth/oauth.ts                Config-gated Google/Apple sign-in
    query/queryClient.ts       TanStack Query client + defaults
    query/QueryProvider.tsx
  store/
    uiStore.ts                Zustand — client-only UI state (see boundary below)
  theme/
    tokens.ts                  Raw design tokens (color/spacing/typography)
    paperTheme.ts               Paper MD3 theme built from tokens
    navigationTheme.ts          Expo Router navigation theme built from tokens
    ThemeProvider.tsx            Combines both + exposes useAppTheme()
  test/
    jest.setup.ts

docs/                      This document set
knowledge/                 LLM Wiki — see docs/LLM_WIKI.md
scripts/
  wiki-lint.mjs             Validates the LLM Wiki structure
supabase/                  See docs/DATA_MODEL.md and docs/SECURITY_AND_PRIVACY.md
  config.toml                Local dev stack config (ports, auth, providers)
  migrations/                 Schema, constraints, RLS, grants, triggers, views
  seed.sql                    System-category seed data only (see file header)
  tests/                      pgTAP tests — supabase test db
```

## Provider stack (`app/_layout.tsx`)

```text
GestureHandlerRootView
 └─ SafeAreaProvider
     └─ AppThemeProvider          (Paper + navigation theme + useAppTheme())
         └─ QueryProvider          (TanStack Query)
             └─ ErrorBoundary
                 └─ Stack           (Expo Router)
```

`initI18n()` runs once at module scope in `app/_layout.tsx`, before the first render — i18next
resources are bundled, not fetched, so this is synchronous and there is no "translations not
ready yet" flash.

## Authentication

Real Supabase Auth (Phase 2) — email/password fully functional against a local Supabase
project; Google/Apple OAuth architecturally complete but config-gated (see
[DECISIONS.md](DECISIONS.md)).

- **`src/lib/auth/authService.ts`** — the only module that calls `supabase.auth.*`. Normalizes
  every failure to an `AuthServiceError` with a stable `code` (never a raw GoTrue message),
  so UI code maps codes to translated strings via `src/domain/auth/errorMessages.ts` instead
  of displaying backend English text.
- **`src/lib/auth/AuthProvider.tsx`** — owns session state app-wide: restores the session on
  launch (`supabase.auth.getSession()`), subscribes to `onAuthStateChange` (sign-in/out,
  token refresh), and fetches the matching `profiles` row into a domain `Profile`
  (`src/domain/profile/`) via `src/domain/profile/mappers.ts` — screens never see a raw
  Supabase row shape. Exposes `useAuth()` → `{ status: 'loading' | 'signed-out' |
'signed-in', session, profile, refreshProfile }`.
- **`app/_layout.tsx`** — renders nothing but a loading state while `status === 'loading'`
  (no flash of signed-in or signed-out content on cold start), then gates the `(auth)` and
  `(app)` route groups with Expo Router's `<Stack.Protected guard={...}>` — one root-level
  guard instead of a redirect check duplicated in every screen. See DECISIONS.md for why
  `app/reset-password.tsx` is a deliberate exception, living outside both guards.
- **`src/lib/auth/oauth.ts`** — Google/Apple via `supabase.auth.signInWithOAuth` +
  `expo-web-browser`'s `openAuthSessionAsync`, gated by `EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`/
  `EXPO_PUBLIC_AUTH_APPLE_ENABLED` (both default `false`). Calling either while disabled
  throws `not_configured` rather than attempting a request that would fail server-side.
- **Deep links**: `familyflow://confirm` (email confirmation → `app/(auth)/confirm.tsx`),
  `familyflow://reset-password` (password recovery → `app/reset-password.tsx`),
  `familyflow://auth-callback` (OAuth safety net → `app/auth-callback.tsx`). Built via
  `src/lib/supabase/authRedirect.ts` (`Linking.createURL`); registered in
  `supabase/config.toml`'s `auth.additional_redirect_urls`.
- **Session persistence**: AsyncStorage, not SecureStore — see DECISIONS.md for the explicit
  trade-off (not encrypted at rest, accepted for documented reasons) and what would change if
  that trade-off is ever revisited.
- **Profile creation**: automatic and idempotent, via a `SECURITY DEFINER` trigger on
  `auth.users` (`supabase/migrations/20260902120100_profiles.sql`) — never client code. See
  [DATA_MODEL.md](DATA_MODEL.md) and [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

## State-management boundaries

This is the rule the brief asked to be explicit about, because getting it wrong is the
single most common React Native architecture mistake:

- **Anything that has a server owner (Supabase) is TanStack Query state.** Tasks, events,
  family data, assignments — all of it, once the backend exists. Query keys, caching,
  retries, and optimistic updates live here, not in Zustand.
- **Zustand holds only state that has no server owner and is genuinely UI-only.**
  `src/store/uiStore.ts` currently holds exactly two things: a light/dark override
  (`colorSchemeOverride`) and which family is currently "active" in the UI
  (`activeFamilyId` — _which_ family to look at, not family membership data itself, which is
  server state). If a future addition to this store starts needing to survive a backend
  round-trip or be visible to another device, it has drifted into query territory and should
  move.
- **React Hook Form owns in-progress form state**, validated by Zod schemas that live in
  `src/domain/*/schemas.ts` (not inline in the screen) so the same validation is reusable and
  unit-testable independent of any component.
- **Auth session state is neither of the above — it's its own `AuthProvider` context**
  (`src/lib/auth/AuthProvider.tsx`, see "Authentication" below). It doesn't fit TanStack
  Query (its source of truth is the Supabase SDK's own in-memory/AsyncStorage session, not a
  request/response cache) or Zustand (every other screen depends on it for routing, not just
  UI presentation). Don't move it into either without a good reason — this was a deliberate
  choice, not an oversight.

## Navigation theming — a note on `expo-router` vs `@react-navigation/native`

As of Expo Router 6 (SDK 56+), importing `ThemeProvider`/`DefaultTheme`/`DarkTheme` from
`@react-navigation/native` directly breaks Expo Router's bundler compatibility check (Metro
throws in the shipped app, not just in a lint rule). `src/theme/navigationTheme.ts` and
`ThemeProvider.tsx` import these from `expo-router` / `expo-router/react-navigation` instead —
Expo Router re-exports (and version-locks) the React Navigation primitives it wraps. See
[DECISIONS.md](DECISIONS.md) for how this was discovered (a Metro export smoke test, not a
lint pass) and why that test is worth keeping in CI.

## Environment configuration

`src/lib/env.ts` parses `process.env.EXPO_PUBLIC_*` through a Zod schema at module load and
throws a clear error if it's invalid, instead of letting an undefined value surface as a
confusing failure deep in a Supabase call. `EXPO_PUBLIC_*` is the only prefix Metro inlines
into the client bundle — anything not meant to be publicly readable (a service-role key, for
instance) must never use this prefix and must live server-side (an Edge Function), never in
this app. `.env.example` documents every variable; `.env` is git-ignored.

`app.config.ts` (not `app.json`) is the Expo config, so `src/config/app-info.json` can drive
both the native manifest and in-app UI from one file — see `src/config/appInfo.ts`'s doc
comment for why that data lives in JSON rather than a `.ts` module (Expo's config loader
can't resolve sibling TypeScript imports).

## Error handling & logging

- `src/components/ErrorBoundary.tsx` catches render-time errors app-wide, logs the error
  message + component stack (never props/state — see
  [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)), and offers a translated retry UI.
- `src/lib/logger/logger.ts` is the only sanctioned way to log from application code —
  `console.*` is disallowed by ESLint outside `warn`/`error`. Swapping in a real sink (Sentry,
  a Supabase log table) later means changing this one file.
- Screens compose `LoadingState` / `EmptyState` / `ErrorState` (`src/components/ui/`) instead
  of ad hoc conditionals, so loading/empty/error treatment stays visually consistent as real
  data-fetching hooks replace the current placeholders.

## Offline & caching (current state, not the V2 design)

TanStack Query's in-memory cache gives cached reads of the last successfully loaded data for
the lifetime of the app process; **no persistence layer (e.g., `persistQueryClient` +
AsyncStorage) is wired up yet**, so "offline reads survive an app restart" is not true today
and this document should not be read as claiming it is. `queryClient.ts`'s conservative retry
defaults (`retry: 1` for queries, `retry: 0` for mutations) exist because, right now, most
failures are "no backend configured" rather than a transient network blip — aggressive
retries would just delay showing the real error state. See [ROADMAP.md](ROADMAP.md),
"Offline behavior," for the V2 design (persistence + conflict resolution rules) this should
grow into.

## Testing

See [TEST_STRATEGY.md](TEST_STRATEGY.md).
