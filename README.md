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
  custom creation). Recurring tasks and reminder scheduling remain MVP-scope but not yet
  built — see [docs/ROADMAP.md](docs/ROADMAP.md), "MVP-scope items not yet built." See
  [docs/DECISIONS.md](docs/DECISIONS.md), "Phase 4."

Still not implemented: shared task assignment UI, event/calendar CRUD UI, Family Today,
recurring-task generation, reminder scheduling, Realtime sync, push notifications — see
[docs/MVP_SCOPE.md](docs/MVP_SCOPE.md) for the exact boundary and
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

## Git workflow

- `main` — stable
- `develop` — integration
- `feature/*` — short-lived feature branches

No secrets, `.env` files, keys, or generated build artifacts are committed — see
`.gitignore` and `.env.example`.
