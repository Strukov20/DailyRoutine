# Architecture

## Stack

| Concern         | Choice                                                         | Version pinned                                    |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Framework       | React Native (via Expo)                                        | RN 0.86.3                                         |
| Toolchain       | Expo SDK                                                       | 57                                                |
| Routing         | Expo Router (file-based, on top of React Navigation internals) | ~57.0.19                                          |
| Language        | TypeScript, `strict: true` + extra strictness flags            | 6.0.3 (pinned — see [DECISIONS.md](DECISIONS.md)) |
| Backend         | Supabase (Postgres, Auth, Realtime, Storage, Edge Functions)    | client 2.113.0                                    |
| Server-state    | TanStack Query                                                 | 5.102.8                                           |
| Client UI-state | Zustand (small, deliberately scoped — see below)               | 5.0.15                                            |
| Forms           | React Hook Form + Zod (`@hookform/resolvers`)                  | 7.87.0 / 4.5.4                                    |
| UI kit          | React Native Paper (Material 3), themed via `src/theme/`       | 5.15.3                                            |
| Notifications   | Expo Notifications + expo-device (client); Deno Edge Function dispatcher + Expo Push Service (server, Phase 6) | 57.0.17 / 57.0.1 |
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
  notification-settings.tsx Permission status, contextual request, assignment-notification toggle (Phase 6)
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
    notifications/ (types.ts, payload.ts, hooks.ts) — Phase 6, see "Push notifications" below
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
    notifications/notificationService.ts       The only module that calls expo-notifications/expo-device (Phase 6)
    notifications/notificationResponseRouter.ts Tap-to-navigate routing, cold/background/foreground (Phase 6)
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
  e2e-backend.sh             Real multi-user backend integration (shared tasks) — npm run e2e:backend
  e2e-notifications.sh       Same, for the notification outbox/dispatcher (Phase 6) — npm run e2e:notifications
supabase/                  See docs/DATA_MODEL.md and docs/SECURITY_AND_PRIVACY.md
  config.toml                Local dev stack config (ports, auth, providers) — deliberately excludes
                              the `notifications` schema from `[api] schemas` (Phase 6, see
                              SECURITY_AND_PRIVACY.md, "Mechanism 4a")
  migrations/                 Schema, constraints, RLS, grants, triggers, views
  seed.sql                    System-category seed data only (see file header)
  tests/                      pgTAP tests — supabase test db
  functions/                  Deno Edge Functions — a separate runtime/module system from the
                              app above, excluded from tsconfig/ESLint/Jest (see "Push
                              notifications" below)
    _shared/                   expoTransport.ts (PushTransport interface + Expo HTTP client),
                              db.ts (direct Postgres connection via SUPABASE_DB_URL)
    dispatch-notifications/    index.ts (the dispatcher, Deno.serve entry point), cli.ts
                              (fake-transport manual/scripted invocation, see e2e-notifications.sh)
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

- **Anything that has a server owner (Supabase) is TanStack Query state.** Tasks (implemented,
  Phase 4 — `src/domain/tasks/hooks.ts`), events, family data, assignments — all of it. Query
  keys, caching, retries, and optimistic updates live here, not in Zustand.
- **Zustand holds only state that has no server owner and is genuinely UI-only.**
  `src/store/uiStore.ts` holds a light/dark override (`colorSchemeOverride`), which family is
  currently "active" in the UI (`activeFamilyId` — _which_ family to look at, not family
  membership data itself, which is server state), and a transient invitation token mid-flow
  (`pendingInviteToken`, Phase 3). If a future addition to this store starts needing to
  survive a backend round-trip or be visible to another device, it has drifted into query
  territory and should move.
- **Optimistic updates are the exception, not the default, and only where rollback is
  trivially safe.** `useCompletePersonalTask`/`useRestorePersonalTask`
  (`src/domain/tasks/hooks.ts`) are the one Phase 4 example: `onMutate` snapshots every
  currently-mounted task-list query before patching the target task, `onError` restores that
  exact snapshot, and the calling component (`TaskRow`) disables its own trigger while the
  mutation is in flight to prevent a duplicate tap. Creation, deletion, scheduling, and any
  other write with a multi-field or security-sensitive effect wait for server confirmation
  with no optimistic update at all — a completion toggle has an obviously safe inverse; most
  other mutations don't, and guessing wrong here is a real-data-loss bug waiting to happen,
  not a minor UX rough edge.
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
  of ad hoc conditionals, so loading/empty/error treatment stays visually consistent across
  screens. `app/(app)/family.tsx` is the first screen built against this with real
  data-fetching hooks rather than a placeholder — see "Layering" below.

## Layering: screens → hooks → repositories → the Supabase client

Established by the family/invitation/child-profile feature (Phase 3) as the pattern every
future feature should follow, mirroring how `src/lib/auth/authService.ts` already isolated
auth's transport calls:

1. **Screens** (`app/**`) never import `@/lib/supabase/client` or call `supabase.rpc(...)` /
   `supabase.from(...)` directly. They call a hook and render its `data`/`isLoading`/`isError`.
2. **Hooks** (`src/domain/<feature>/hooks.ts`) wrap a service function in a TanStack Query
   `useQuery`/`useMutation`, own query keys and cache invalidation, and are the only layer
   Zustand and TanStack Query state get reconciled in (see `useActiveFamily()` for the
   pattern — it's the one place `uiStore.activeFamilyId` and the family list meet).
3. **Repositories/services** (`src/lib/<feature>/<feature>Service.ts`) are the only place that
   calls the Supabase client, and the only place that normalizes a raw Postgres/PostgREST
   error into a typed `<Feature>ServiceError` with a stable `code` — see
   `src/lib/family/familyService.ts` for the full pattern (mirrors `AuthServiceError`).
4. **Domain types/mappers/schemas** (`src/domain/<feature>/{types,mappers,schemas,errorMessages}.ts`)
   stay framework-agnostic: mappers narrow the generated (CHECK-constraint-widened) Supabase
   row shape to a real union type, schemas validate form input independent of any screen, and
   `errorMessages.ts` maps a service error code to an i18n key — never inline English strings
   in a screen.

A screen reaching past its hook into `familyService` (or, worse, `supabase` directly) is a
layering violation to fix on sight, not a style nitpick — it's what keeps error normalization,
cache invalidation, and the RPC-only write boundary (see
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)) from being reimplemented ad hoc per screen.

## Push notifications (Phase 6)

Scoped to shared family task assignment events only (assigned/reassigned → requested,
accepted, declined, took → taken) — see [DATA_MODEL.md](DATA_MODEL.md), "The `notifications`
schema," and [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), "Mechanism 4," for the data
model and privacy design. This section is about where the code lives and how the pieces fit.

**Durable outbox, not a direct send.** A mutation RPC (`assign_family_task`,
`accept_task_assignment`, etc.) never sends a push itself — it only inserts a
`task_assignments` row, same as before Phase 6. A trigger on that same table
(`notifications.enqueue_task_assignment_notification`) enqueues a `notifications.outbox` row
in the *same transaction*, so a notification is never lost to a mid-request crash and never
blocks the mutation on network/provider latency. A separate worker (the dispatcher, below)
claims and sends outbox rows asynchronously. This is the standard transactional-outbox
pattern, chosen specifically so "the assignment succeeded" and "the push was sent" can never
partially fail into an inconsistent state.

**Client layer** (mirrors the existing `authService.ts` pattern exactly):

- `src/lib/notifications/notificationService.ts` — the only module that calls
  `expo-notifications`/`expo-device`, and the only place that calls the
  `register_notification_token`/`notification_preferences` RPCs. Every failure mode throws a
  typed `NotificationServiceError` with a stable `code`, same shape as `AuthServiceError`.
- `src/domain/notifications/hooks.ts` — TanStack Query hooks wrapping that service
  (permission status, registration, preference read/write) — screens never call the service
  directly, same layering rule as every other feature (see "Layering" above).
- `app/notification-settings.tsx` — the only screen that requests notification permission,
  and only on explicit user action (never on app launch — see
  [DECISIONS.md](DECISIONS.md)/[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) for why a
  contextual permission ask matters).
- `src/lib/notifications/notificationResponseRouter.ts` — handles a tapped notification in
  all three states (cold start via `getLastNotificationResponseAsync`, background/foreground
  via `addNotificationResponseReceivedListener`), deduplicated by the notification's own
  response id, resolving `src/domain/notifications/payload.ts`'s parsed (Zod-validated)
  payload to the existing task editor route. A tap while signed out is preserved via
  `uiStore.pendingNotificationRoute` and replayed once sign-in completes — the same pattern
  Phase 3 established for `pendingInviteToken`, not a new one invented for this feature.
  Mounted once, app-wide, in `app/_layout.tsx` (active for the whole app lifetime, not just
  while signed in, so a signed-out tap isn't missed).

**Server layer — a separate runtime from the rest of this app.**
`supabase/functions/dispatch-notifications/index.ts` is a Deno Edge Function, not a Node
module: it uses `npm:`/`https://` import specifiers, a global `Deno` object, and its own
`deno.json`/`deno.lock` (`supabase/functions/`). It is explicitly excluded from `tsconfig.json`,
`eslint.config.js`, and `jest.config.js` so the main app's Node-oriented tooling never tries
to parse Deno-specific syntax. `dispatchNotifications()` is exported and unit-testable in
isolation from the `Deno.serve(...)` HTTP entry point (guarded by `import.meta.main`, so
importing the module for a test never starts a real listener):

1. **Claim** — `notifications.claim_pending_outbox()` (`FOR UPDATE SKIP LOCKED`, so multiple
   concurrent dispatcher invocations never double-send the same row).
2. **Send** — looks up the recipient's active (non-deactivated) tokens, batches them through a
   `PushTransport` (an interface, not a concrete `fetch` call — the real implementation
   (`_shared/expoTransport.ts`'s `createExpoTransport`) talks to Expo's HTTP push API; tests
   and `cli.ts` inject a fully fake, network-free implementation instead), and records a
   `notifications.deliveries` row per device.
3. **Classify** — a `DeviceNotRegistered` ticket/receipt deactivates that
   `notification_tokens` row (`notifications.deactivate_notification_token`); other errors are
   retried at the outbox level with bounded exponential backoff (capped 30 minutes).
4. **Check receipts** — a later invocation polls Expo's receipt endpoint for tickets still
   `ticket_ok`, resolving them to `receipt_ok`/`receipt_error` (Expo's own two-phase
   send-then-receipt flow — a ticket being "ok" only means Expo accepted the message, not that
   the device received it).

Reaches `notifications.outbox`/`deliveries` via a direct Postgres connection
(`_shared/db.ts`, `SUPABASE_DB_URL`), the only way in — see SECURITY_AND_PRIVACY.md,
"Mechanism 4a," for why (the schema is absent from PostgREST's routing config entirely).

**Invocation — designed, not deployed.** Two invocation paths call the same handler: a
Supabase Database Webhook on `notifications.outbox` INSERT (low latency) and a `pg_cron`
sweep on a short interval (a durable fallback that picks up anything the webhook missed).
Neither is wired up yet — see [DECISIONS.md](DECISIONS.md) for the exact manual dashboard/CLI
step required, which was deliberately not performed automatically (see this repository's
standing rule against creating/modifying external resources without explicit authorization).

## Family calendar (Phase 7)

Full design in [DATA_MODEL.md](DATA_MODEL.md) and
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). Architecturally notable:

- **`events`/`event_participants`/`responsibilities` (Phase 2 schema) moved to RPC-only
  writes this phase** — an audit finding, same class of gap Phase 4 found for `tasks` (see
  [DECISIONS.md](DECISIONS.md)). `SELECT` stays direct/RLS-governed.
- **A second append-only audit table**, `responsibility_assignments`, mirrors
  `task_assignments` exactly rather than being reused from it — a responsibility and a task
  are different domain concepts with different owning tables, and mixing them would make
  "every assignment this member ever had" ambiguous between the two.
- **Two sanitized read views** feed the Calendar screen's Family-mode agenda:
  `family_schedule` (events, evolved this phase to exclude soft-deleted rows and expose a
  `participant_member_id`) and `family_responsibilities` (drop-off/pick-up, new this phase) —
  the client combines both into one chronological list rather than either view trying to be
  everything.
- **Conflict detection is a read-only RPC, not a table or a client-side computation** —
  `has_member_schedule_conflict()` returns a boolean only, checked against the *current*
  member's own events/tasks/other-accepted-responsibilities server-side, so the privacy
  guarantee (never reveal what it conflicted with) holds regardless of what the client is
  allowed to query directly.
- **Timezone handling**: `events.starts_at`/`ends_at` are `timestamptz` (an unambiguous UTC
  instant by construction) with `timezone` (IANA) stored alongside for rendering and local-day
  query-boundary computation — `src/domain/calendar/dateUtils.ts`'s `localDayBoundsUtc` goes
  through the local `Date` constructor (DST-correct) rather than a fixed offset, the same
  "local-constructor-only" discipline `src/domain/tasks/dateUtils.ts` established in Phase 4,
  applied to a genuinely different problem (a real instant vs. a deliberately ambiguous local
  date string).
- **Calendar screen doubles as Family Today** — no separate screen was built for "the combined
  daily schedule"; the Calendar screen's own Family mode, defaulted to today, is that view.
  Avoids two near-duplicate agenda screens for what the brief's own worked examples show as
  the same underlying data (a day's events + responsibilities, filterable by member).
- **Push notifications extend, not duplicate, the Phase 6 outbox** — see "Push notifications"
  above; `notifications.outbox` gained nullable `event_id`/`responsibility_id` columns
  alongside the existing `task_id`/`task_assignment_id` ones, with a `CHECK` enforcing exactly
  one source per row, and a second trigger (`enqueue_event_responsibility_notification`) on
  `responsibility_assignments` mirroring the task one.

## Recurring tasks and local reminder scheduling (Phase 8)

Full design in [DATA_MODEL.md](DATA_MODEL.md) and [DECISIONS.md](DECISIONS.md). Two
independent features share this phase but are architecturally separate:

**Recurrence** — bounded materialized occurrences (`task_occurrences`), generated lazily and
idempotently by `generate_task_occurrences` into a 45-day rolling horizon, never an unbounded
background job. `src/lib/recurrence/recurrenceService.ts` wraps every recurrence RPC;
`src/domain/recurrence/hooks.ts` exposes them as TanStack Query hooks. The read model
(`personal_task_occurrences`) is unioned into the existing `listTasksForDate`/`listOverdueTasks`
in `src/lib/tasks/taskService.ts` — Today/Tomorrow extend rather than duplicate the pre-Phase-8
task list, and occurrence actions (complete/restore/reschedule/skip) are **non-optimistic**
(invalidate-only): a recurring task's `id` repeats across occurrences, so an optimistic cache
patch keyed by task id risks mutating the wrong occurrence in another mounted list.

**Local reminder scheduling — a second notification pathway, deliberately separate from Phase
6's server push outbox.** A reminder's content and fire time are entirely known on-device in
advance, so nothing is server-authoritative here; scheduling goes straight through
`expo-notifications`, behind a small testable interface:

- `src/lib/reminders/localNotificationScheduler.ts` — the `LocalScheduler` interface
  (`schedule`/`cancel`/`listScheduled`) and its one real implementation (`expoLocalScheduler`).
  Screens/hooks never call `expo-notifications` directly.
- `src/lib/reminders/reminderReconciliation.ts` — `reconcileReminders()`, the production
  diff-and-apply algorithm (what should be scheduled vs. what is), called from
  `useReminderReconciliation()` at fixed lifecycle points (auth-ready, app-foreground, and after
  any mutation that could change what's due) — **never continuously**. Jest's fake-scheduler
  suite exercises this exact function against an in-memory fake, never a reimplementation of it.
- `src/components/tasks/ReminderEditorSection.tsx` — the only place `requestNotificationPermission()`
  is called, and only from "add the first reminder," never at app startup (see
  [DECISIONS.md](DECISIONS.md) for the permission-timing gap this closed).
- `src/lib/notifications/useReminderNotificationActions.ts` — handles Snooze/Done/Custom
  actions and taps on a *local* reminder notification (payload shaped
  `{ notificationType: 'task_reminder', ... }`), mounted alongside, but disambiguated from,
  Phase 6's `useNotificationResponseRouter` (server-push payloads have no `notificationType`
  field — `resolveNotificationRoute` explicitly excludes any payload where one is present, so
  the two routers can never both react to the same tap).

Reminder identity is a deterministic string key
(`` `${profileId}:${taskId}:${occurrenceId ?? 'series'}:${reminderId}` ``), embedded in the
notification's own `data.reminderKey` at schedule time — never derived from the opaque native
notification id `expo-notifications` assigns.

**A known, real interaction-testability limitation, not an application defect**: both
`ReminderEditorSection`'s and the task editor's Category picker's `react-native-paper` `<Menu>`
never visibly opens when driven by Maestro's synthetic taps on a screen presented via
expo-router's `presentation: 'modal'`, though the same component is already documented as
unreliable under Jest/react-test-renderer since Phase 5. See
[DECISIONS.md, "Phase 8"](DECISIONS.md) for the full diagnostic evidence (hierarchy dump,
frame-by-frame video) and [TEST_STRATEGY.md](TEST_STRATEGY.md) for the resulting test-writing
convention. Worked around, not left blocking real device verification: a temporary `__DEV__`-only
diagnostic screen (`app/dev-diagnostics.tsx`, absent from any production build **and since
removed from the codebase entirely** — see below) called the same production
`requestNotificationPermission`/`reconcileReminders`/`expoLocalScheduler.listScheduled`
functions the broken Menu items would have, letting permission-grant, scheduling, delivery,
reschedule, and cancellation all be directly observed on a real device — see
[DECISIONS.md, "Phase 8"](DECISIONS.md) for the full evidence, preserved there even though the
diagnostic route itself no longer exists. Tap-to-navigate and the Snooze/Done notification
*actions* remain unverified on-device for a separate, structural reason (cross-process iOS
system UI is outside Maestro's automation scope for an `appId`-scoped flow). The production
functions the diagnostic exercised (`requestNotificationPermission`, `reconcileReminders`,
`expoLocalScheduler`, `useReminderNotificationActions`) are unaffected by its removal — none of
them depended on the diagnostic screen; it only called them.

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
