# FamilyFlow

A personal and family planner for iOS and Android — personal tasks, calendar events,
reminders, and a shared family schedule with explicit responsibility assignment (e.g.,
separate drop-off/pickup for a child's event). "FamilyFlow" is a working name — see
[`src/config/app-info.json`](src/config/app-info.json).

Full product/architecture documentation lives in [`docs/`](docs/):

- [docs/PRODUCT.md](docs/PRODUCT.md) — what this is and the core domain model
- [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md) — what's in vs. out of the MVP
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, folder structure, state boundaries
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — proposed Supabase schema
- [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) — RLS + privacy design
- [docs/ROADMAP.md](docs/ROADMAP.md) — V2/V3 and how the architecture anticipates them
- [docs/DECISIONS.md](docs/DECISIONS.md) — why things were built the way they were
- [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md) — what's tested and how
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — push notification deployment runbook (not yet executed)
- [docs/LLM_WIKI.md](docs/LLM_WIKI.md) — the `knowledge/` LLM Wiki: how to read/maintain it

## Current state

- **Phase 1 (foundation)**: app shell, navigation, theming, localization (English +
  Ukrainian), environment/config validation, quality tooling (lint/typecheck/test/CI).
- **Phase 2 (Supabase foundation)**: database schema + Row Level Security implemented in
  `supabase/migrations/` (see [docs/DATA_MODEL.md](docs/DATA_MODEL.md) and
  [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md)), real email/password
  authentication (sign-up, sign-in, sign-out, password reset, email confirmation — see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), "Authentication"), Google/Apple sign-in
  architecturally complete but config-gated off by default.
- **Phase 3 (Family Space)**: family creation, hashed-token invitations (deep-link/Share/
  copy-link delivery, no email provider), Owner/Adult/Child permissions, child profiles — all
  RPC-only writes. See [docs/DECISIONS.md](docs/DECISIONS.md), "Phase 3."
- **Phase 4 (Personal Tasks)**: full personal-task lifecycle (create, edit, complete, restore,
  schedule, archive) via RPC-only writes; Inbox, Today (overdue/timed/anytime/completed), and
  Tomorrow screens with quick-add and a full editor; categories (system defaults + basic
  custom creation). Recurring tasks and reminder scheduling were MVP-scope but not yet built at
  this phase — see Phase 8 below. See [docs/DECISIONS.md](docs/DECISIONS.md), "Phase 4."
- **Phase 5 (Shared Family Tasks)**: assign/reassign/take/accept/decline for family-visible
  tasks, an auditable `task_assignments` history, and a Family task board UI — all RPC-only
  writes, real multi-user backend integration (`scripts/e2e-backend.sh`), and Maestro E2E
  coverage of the full assignment workflow. See [docs/DECISIONS.md](docs/DECISIONS.md), "Phase
  5."
- **Phase 6 (Push Notifications)**: push notifications for the four shared-task assignment
  events (assigned/reassigned, accepted, declined, taken) via a durable transactional outbox
  and a Supabase Edge Function dispatcher (Expo Push Service) — see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), "Push notifications," and
  [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md), "Mechanism 4." Client-side
  token registration, a Notification Settings screen, and tap-to-navigate routing are
  implemented and tested against real local infrastructure; **no real device/EAS build has
  sent or received an actual push this phase** — see [docs/DECISIONS.md](docs/DECISIONS.md),
  "Phase 6," for the exact manual configuration steps still required.
- **Phase 6.1 (Deployment & Real Device Push Validation)**: a durable, schema-driven security
  regression guard for the anon-EXECUTE-grant class of finding that had recurred across three
  prior phases (`supabase/tests/130_security_regression_test.sql`), a secret/bundle audit
  specifically for `NOTIFICATION_WORKER_SECRET`, and a full deployment runbook
  ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)) — exact commands for EAS setup, the hosted
  Supabase deploy, the Database Webhook/`pg_cron` dispatcher trigger, and the manual
  on-device acceptance matrix. **Still not deployed**: no EAS project or hosted Supabase
  project is linked to this repository, and no physical device has received a real push —
  both require the operator's own accounts and hardware, which an agent cannot supply. See
  [docs/DECISIONS.md](docs/DECISIONS.md), "Phase 6.1."
- **Phase 7 (Family Calendar, Child Events, and Responsibilities)**: the MVP Day Calendar —
  personal/family/child events, drop-off/pick-up responsibilities as records separate from
  the event they attach to (never a text field on the event), the responsibility assignment
  state machine (assign/reassign/take/accept/decline/remove), Busy-block privacy for private
  family-linked events, and deterministic privacy-safe conflict detection (a warning only,
  never a blocked save). Push notifications extended (not duplicated) to event-responsibility
  events. Deterministic Jest UI coverage for the Day Calendar screen, the event editor, and
  responsibility controls was added in a Phase 7 follow-up audit, alongside an offline banner
  and pull-to-refresh for the calendar screen. See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), "Family calendar," and
  [docs/DECISIONS.md](docs/DECISIONS.md), "Phase 7" and "Phase 7 follow-up." Week/Month views,
  recurring events, and Maestro E2E coverage for this feature are explicitly deferred — see
  [docs/ROADMAP.md](docs/ROADMAP.md).
- **Phase 8 (Recurring Tasks, Scheduled Reminders, and Snooze)**: server-authoritative
  recurrence (Daily/Weekly/Monthly/Yearly/Custom, DST-safe, bounded materialized occurrences on
  a 45-day rolling horizon) with individual occurrence complete/restore/reschedule/skip vs.
  entire-series update/stop; a device-local reminder scheduler (relative or absolute reminders,
  multiple per task) built as a testable interface around `expo-notifications`, deliberately
  separate from Phase 6's server push outbox; deterministic reconciliation at fixed app
  lifecycle points; Snooze/Done/Custom notification actions. See
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), "Recurring tasks and local reminder scheduling,"
  and [docs/DECISIONS.md](docs/DECISIONS.md), "Phase 8." Real native build/launch/sign-in/data-
  flow was verified on an iOS Simulator this phase; real on-device local-notification delivery/
  tap/action verification could not be completed due to a genuine `react-native-paper` `<Menu>`
  interaction limitation under Maestro automation — see DECISIONS.md for the full evidence and
  what remains unverified.

Still not implemented: Realtime sync, notifications for anything beyond shared-task/
responsibility-assignment/reminder events, Week/Month calendar views, and shared/family
recurring tasks — see [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md) for the exact boundary,
[docs/ROADMAP.md](docs/ROADMAP.md) for what's deliberately deferred, and
[docs/DECISIONS.md](docs/DECISIONS.md) for why things were built the way they were.

## Getting started

```bash
npm install
cp .env.example .env   # fill in Supabase URL/anon key once you've run supabase:start
npm run supabase:start  # local Supabase stack — needs Docker running
npm run db:reset         # applies migrations + seed data
npm run ios              # or: npm run android
```

Without `supabase:start`, the app still boots (the Supabase client falls back to a
placeholder), but sign-up/sign-in will fail — see `src/lib/supabase/client.ts`.

### Scripts

| Command                                    | Does                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| `npm run start`                            | Start the Expo dev server                                    |
| `npm run ios` / `npm run android`          | Start the dev server and open the platform                   |
| `npm run lint` / `npm run lint:fix`        | ESLint                                                       |
| `npm run format` / `npm run format:check`  | Prettier                                                     |
| `npm run typecheck`                        | `tsc --noEmit`                                               |
| `npm run test` / `npm run test:watch`      | Jest                                                         |
| `npm run wiki:lint`                        | Validate the `knowledge/` LLM Wiki (see docs/LLM_WIKI.md)    |
| `npm run verify`                           | lint + typecheck + test + wiki:lint, in that order           |
| `npm run supabase:start` / `supabase:stop` | Start/stop the local Supabase stack (needs Docker)           |
| `npm run db:reset`                         | Rebuild the local database from migrations + seed data       |
| `npm run db:test`                          | Run the pgTAP suite in `supabase/tests/`                     |
| `npm run db:types`                         | Regenerate `src/lib/supabase/types.ts` from the local schema |
| `npm run e2e:seed`                         | Seed real accounts/data for Maestro E2E runs                 |
| `npm run e2e:ios`                          | Run the Maestro E2E flows in `.maestro/` against the iOS Simulator |
| `npm run e2e:backend`                      | Real multi-user backend integration — shared tasks (`scripts/e2e-backend.sh`) |
| `npm run e2e:notifications`                | Real multi-user backend integration — notification outbox/dispatcher (`scripts/e2e-notifications.sh`) |
| `npm run e2e:calendar`                     | Real multi-user backend integration — events/responsibilities/conflict detection (`scripts/e2e-calendar.sh`) |
| `npm run e2e:recurrence`                   | Real multi-user backend integration — recurrence, occurrences, reminders (`scripts/e2e-recurrence.sh`) |

## Git workflow

- `main` — stable
- `develop` — integration
- `feature/*` — short-lived feature branches

No secrets, `.env` files, keys, or generated build artifacts are committed — see
`.gitignore` and `.env.example`.
