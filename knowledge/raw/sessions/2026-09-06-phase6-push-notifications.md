# Session: Phase 6 — Reliable Family Assignment Push Notifications

Date: 2026-09-06. Branch: `feature/push-notifications`, based on `develop`'s tip after Phase
5's PR was merged. Continues directly from the Phase 5 session
(`knowledge/raw/sessions/2026-09-05-phase5-shared-family-tasks.md`).

## Brief (condensed — full text in `docs/DECISIONS.md`'s Phase 6 section)

Build reliable push notifications for four shared-family-task assignment events (assigned/
reassigned → requested, accepted, declined, took → taken): a durable transactional outbox, a
Supabase Edge Function dispatcher using Expo Push Service with atomic claiming/retry/backoff/
receipt-processing/token-deactivation, full client-side token registration + a Notification
Settings screen (permission requested only contextually, never on launch), notification-tap
navigation handling (cold start/background/foreground, signed-out pending-target preservation,
unauthorized/deleted-task friendly fallback, malformed-payload-safe-ignore, dedup), and
pgTAP + Edge Function + client tests all against real local infrastructure (never mocks for
privacy/security-relevant behavior) with a fake-only Expo transport (never real push sends in
tests). Explicit non-goals: recurring tasks, reminders, digests, quiet hours, AI, email/SMS, a
full inbox, calendar/child UI, ownership transfer, direct APNs/FCM. Explicit constraint: never
push/merge/PR/rewrite history/delete branches; never create/modify external EAS/Apple/
Firebase/hosted-Supabase resources without explicit authorization.

## What was built

### Database (`supabase/migrations/20260906120000_notification_outbox.sql`)

- `notification_tokens.deactivated_at` (nullable) + `register_notification_token(...)` — always
  reassigns an existing token string to the calling profile (device resale/reinstall), clears
  `deactivated_at`.
- `notification_preferences` (owner-only RLS) + `notification_preference_enabled(profile_id)`
  (defaults `true` via `coalesce`).
- A private `notifications` schema — `create schema notifications; revoke all ... from public,
  anon, authenticated;` **and** excluded from `supabase/config.toml`'s `[api] schemas` list, so
  PostgREST routes to it for no role at all, including `service_role`. This is a stronger
  guarantee than every other table in this codebase (RLS + grants) and was a deliberate choice
  — see `docs/DECISIONS.md`, "Phase 6."
- `notifications.outbox` / `notifications.deliveries` — the outbox pattern; full column detail
  in `docs/DATA_MODEL.md`.
- `notifications.enqueue_task_assignment_notification()` — a second `AFTER INSERT` trigger on
  `task_assignments`, alongside the pre-existing `apply_task_assignment_action`, deriving the
  recipient from current `family_members`/`task_assignments` state, never the client. Recipient
  table: requested → new assignee; accepted/declined → the assigner if any; taken → prior
  assigner if known else the family owner. Never the actor; never a removed member; checked
  against `notification_preferences` at dispatch time, not enqueue time.
- `notifications.claim_pending_outbox` (`FOR UPDATE SKIP LOCKED`), `backoff_interval` (bounded
  exponential, capped 30 min), `finish_outbox_attempt`, `deactivate_notification_token`.
- Idempotency: `idempotency_key` unique, derived as `task_assignment:<task_assignments.id>`,
  `insert ... on conflict do nothing`.

**Bug caught before applying**: the first draft missed the explicit
`revoke all ... from public, anon, authenticated` on two new functions
(`enqueue_task_assignment_notification`, `backoff_interval`) — the same
Supabase-grants-EXECUT-directly gap Phase 3 and Phase 5 both hit. Caught by directly querying
`pg_proc`/`has_function_privilege` via `docker exec -i supabase_db_familyflow psql`, not by
re-reading the migration (which looked correct at a glance). Fixed, re-verified with the same
query.

`supabase/tests/110_notification_outbox_test.sql` — 30 assertions: every event type,
self-notification suppression, removed-member suppression, disabled-preference suppression,
default-true preference, dedup, RPC-replay safety, complete schema inaccessibility (SELECT and
every internal function, both `authenticated` and `anon`), and token
ownership/lifecycle. **Verified: `npx supabase test db` → 293/293 total (263 existing + 30
new), all pass.**

Along the way, several pgTAP authoring bugs were found and fixed (not product bugs): a
`results_eq`/`:'var'` substitution not applying inside `$...$` dollar-quoted strings (rewrote
to `format(...)`), a fixture ordering bug where a dedup-test recipient's own notification
preference had just been disabled by the prior test section, an ambiguous `status` column in
JOINed `deliveries`/`outbox` queries (qualified as `d.status`), a polymorphic-type error on two
untyped literals (explicit `::uuid` casts), and a `throws_ok` misuse for an UPDATE that RLS
silently no-ops on (switched to `lives_ok`).

### Edge Function (`supabase/functions/dispatch-notifications/`)

Deno module tree, separate from the main Node/Metro app — own `deno.json`/`deno.lock`, `npm:`/
`https://` import specifiers, a global `Deno`, `import.meta.main`. Excluded from
`tsconfig.json`'s `exclude`, `eslint.config.js`'s `globalIgnores`, `jest.config.js`'s
`testPathIgnorePatterns` — none of the three tools can parse Deno syntax, and the fix is
exclusion, not a shared config.

- `_shared/expoTransport.ts` — `PushTransport` interface (`sendBatch`/`getReceipts`),
  `createExpoTransport(fetchImpl)` (the real implementation), `classifyExpoError()`,
  `isValidExpoPushToken()`, `chunk()`.
- `_shared/db.ts` — `createDbClient()` via `npm:postgres@3.4.4`, reading `SUPABASE_DB_URL` — the
  only way to reach the `notifications` schema, even with service-role-equivalent trust.
- `index.ts` — `dispatchNotifications(sql, transport, limit, workerId)` (exported, testable) +
  `Deno.serve(...)` guarded by `import.meta.main` so importing the module for a test never
  starts a real listener. Claim → send (batched, per-token) → classify (DeviceNotRegistered →
  deactivate; other errors → bounded retry) → check receipts (Expo's two-phase flow).
- `index.test.ts` — 11 Deno test steps against real local Postgres + a `FakeTransport`, with a
  `withFixture()` helper. **Final result: `ok | 1 passed (11 steps) | 0 failed`.**

Real bugs found and fixed while building this: initially imported the wrong Deno Postgres
library (`deno.land/x/postgres` — a completely different Client/Pool API with no
tagged-template `sql\`...\`` syntax) before switching to `npm:postgres@3.4.4`; Deno initially
refused to auto-install `npm:postgres` inside the parent repo's own `package.json` directory
(fixed with `supabase/functions/deno.json`'s `nodeModulesDir: "auto"`); several TypeScript
errors from postgres.js's `Row` typing needing explicit casts; `Deno.serve(...)` firing as a
side effect of the test file's own import (fixed via the `import.meta.main` guard above); the
same FK-ordering fixture-cleanup bug from `scripts/e2e-backend.sh` (Phase 5) rediscovered in
the Deno test's own cleanup (`task_assignments`' two composite FKs to `family_members` block a
direct `families`/`family_members` delete — clear `task_assignments`/`tasks` first); the same
ambiguous-`status`-column bug as the pgTAP file, fixed identically.

### Client (`src/lib/notifications/`, `src/domain/notifications/`, `app/notification-settings.tsx`)

Mirrors `authService.ts`'s established pattern exactly:

- `notificationService.ts` — the only module calling `expo-notifications`/`expo-device`;
  typed `NotificationServiceError`. `registerForPushNotifications()`: physical-device check →
  projectId check → permission request → Android channel → obtain token → upsert via RPC.
  `deactivateCurrentDeviceToken()`: best-effort, never throws, called before `signOut()` in
  `app/(app)/profile.tsx` (deliberately awaited first, while a valid session still identifies
  "this device's token").
- `src/domain/notifications/{types,payload,hooks}.ts` — Zod payload schema (`schemaVersion`,
  `eventType`, `familyId`, `taskId` — ids only, never content), TanStack Query hooks.
- `app/notification-settings.tsx` — permission status, contextual request button, system
  settings deep link, assignment-notification toggle. The only place permission is ever
  requested.
- `src/lib/notifications/notificationResponseRouter.ts` — `resolveNotificationRoute()` +
  `useNotificationResponseRouter(isSignedIn)`, mounted once in `app/_layout.tsx` for the app's
  whole lifetime. Cold start via `getLastNotificationResponseAsync`, background/foreground via
  `addNotificationResponseReceivedListener`, deduplicated by response id. A signed-out tap is
  preserved via `uiStore.pendingNotificationRoute` and replayed post-sign-in — the same pattern
  Phase 3 built for `pendingInviteToken`.
- `src/i18n/locales/{en,uk}/notifications.json`, registered in `src/i18n/index.ts`.
- `expo-device` added via `npx expo install expo-device`; `expo-notifications` was already a
  dependency from the original scaffold.

### Client tests and the two RNTL/Jest gotchas found

`notificationService.test.ts`, `payload.test.ts`, `notificationResponseRouter.test.ts` — 28
tests, all passing after two non-obvious bugs were root-caused via isolated minimal repros
(not guessed):

1. **`act(() => {...})` (sync) after `await renderHook(...)` corrupts React's act-scope for
   the *next* test's `renderHook` in the same file.** Symptom: a mock's call history
   (`addNotificationResponseReceivedListener`) showing 0 calls on every test after the one
   using a bare `act()`, even though each later test's own `renderHook` looked normal read in
   isolation. Reproduced with a minimal two-test file, confirmed the fix
   (`await act(async () => {...})` everywhere, plus `await unmount()` — also async in RNTL 14)
   resolves it in the same minimal repro before applying it to the real suite.
2. **Mocking a plain boolean export a test needs to mutate per-test (`expo-device.isDevice`)
   needs a live getter, not a plain data property.** `jest.mock('expo-device', () => ({
   isDevice: true }))` plus `(Device as any).isDevice = false` in a test looks correct but
   doesn't work — each file's own `import * as Device` gets its own ESM-interop-wrapped copy
   (Babel's `_interopRequireWildcard` snapshots a data property's *value* at wrap time), so a
   test's mutation never reaches the copy `notificationService.ts` itself reads. Confirmed via
   a side-by-side repro comparing `import * as X` against a direct `require()` of the same
   mocked module — the `require()` copy sees the mutation, the `import *` copy doesn't. Fixed
   by backing the property with a module-level `let` and exposing a getter, which survives the
   interop copy as a live accessor.

Also fixed along the way: an RFC-4122 UUID validation bug in this session's own test
fixtures (Zod v4's `.uuid()` enforces version/variant nibbles; placeholder UUIDs like
`11111111-1111-1111-1111-111111111111` fail it) — root-caused via an isolated `node -e`
script, confirming `payload.ts`'s own schema was correct all along; a JS syntax bug (SQL-style
`''` apostrophe escaping used inside single-quoted JS strings).

### Backend integration script (`scripts/e2e-notifications.sh`, `npm run e2e:notifications`)

Extends `scripts/e2e-backend.sh`'s pattern: real `auth.users` accounts, real assignment RPCs,
and the *real* dispatcher code (imported, not reimplemented) run via a small Deno CLI wrapper
(`supabase/functions/dispatch-notifications/cli.ts`) supplying only the transport as fake.
Same safety gate (localhost-only, checked against both `API_URL` and `DB_URL` independently),
unique per-run identities, `set -euo pipefail`, `trap`-based cleanup including the
`notifications` schema's own rows (not REST-reachable, cleaned up via a direct `psql`
connection through the running `supabase_db_familyflow` container).

24 checks: outbox creation for all four event types, self-notification suppression (assigning
to yourself enqueues nothing), dispatch/delivery against the fake transport, dedup on a second
dispatch (0 reclaimed), `DeviceNotRegistered` → token deactivation, a recipient left with only
a deactivated token (outbox row `skipped`), and authorization boundaries (the `notifications`
schema 404s via REST even with `service_role`; an outsider cannot read another profile's
`notification_tokens`/`notification_preferences` row; re-registering a token string reassigns
it to the new caller and the prior owner loses visibility).

Two portability bugs found and fixed while writing it: `curl` needs `--globoff` for any URL
containing an Expo push token string (`ExponentPushToken[...]` — the brackets are otherwise
parsed as a curl range expression, silently producing a 3xx-looking failure); bash 3.2
(confirmed via `bash --version` — still macOS's default `/bin/bash` in 2026) treats
`"${array[@]}"` on a genuinely empty array as an unbound-variable error under `set -u`, unlike
bash 4+ — worked around with `${array[@]+"${array[@]}"}` rather than disabling `set -u`. One
test-count bug in the script's own assertions (expected 4 pending outbox rows, actual and
correct count was 5 — task 2's decline flow legitimately also produces a `requested` event
before the `declined` one) was found and fixed the same way: read the real data via `psql`
before assuming the assertion was right.

**Verified: `npm run e2e:notifications` → 24/24 passed, run twice consecutively with no
residue** (confirmed via a direct `psql` count of both `notifications.outbox` rows and the
seeded family row after the second run — both zero).

## Verification (full loop)

- `npm run verify` (lint + typecheck + test + wiki:lint) — lint 0 errors/0 warnings, typecheck
  clean, **200/200 Jest tests across 31 suites**, wiki:lint passed.
- `npx supabase test db` — **293/293 pgTAP assertions across 11 files**, all pass.
- `cd supabase/functions && deno test --allow-net --allow-env` — **11/11 Deno test steps**, all
  pass.
- `npm run e2e:notifications` — **24/24, run twice, no residue**.
- `npx expo-doctor` — **21/21**.
- `npx expo config --type public` — resolves cleanly; `expo-notifications`/`expo-device`
  plugins correctly registered; no secrets present.
- `npx expo export --platform ios` and `--platform android` — both succeeded. `strings` +
  `grep` scan of both compiled Hermes bundles for `SERVICE_ROLE`/`SUPABASE_AUTH_EXTERNAL_*`/
  other server-only secret patterns — none found.

## Not done this phase, by design

Per the standing rule against creating/modifying external resources without explicit
authorization: no Database Webhook or `pg_cron` schedule was created to actually invoke
`dispatch-notifications` (both call the same exported handler — wiring either up is a
dashboard/CLI config step, not a code change); no `NOTIFICATION_WORKER_SECRET` was set; the
function was not deployed (`supabase functions deploy`); no EAS project was created or linked.
**No real push notification has been sent or received this phase** — every test at every layer
uses a fake `PushTransport`. Full manual-step list: `docs/DECISIONS.md`, "Phase 6," last
section.

## Status at this write-up

All code committed on `feature/push-notifications` (4 commits, based on `develop`'s tip after
Phase 5's merge): DB/migration/pgTAP, Edge Function/Deno tests, client token
lifecycle/settings/routing, backend integration script. Documentation and this wiki pass are
the last item, done in this same session. Nothing pushed, merged, or PR'd — all standing
constraints held throughout.
