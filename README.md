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

## Current state: foundation phase

This repository currently contains the **foundation** for FamilyFlow, not the MVP itself:
app shell, navigation, theming, localization (English + Ukrainian), environment/config
validation, a Supabase client with no real project connected, and the quality tooling
(lint/typecheck/test/CI). No authentication, task/event persistence, or family
invitations are implemented yet — see [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md) for the exact
boundary and [docs/DECISIONS.md](docs/DECISIONS.md) for why.

## Getting started

```bash
npm install
cp .env.example .env   # optional — the app runs with a placeholder Supabase client without it
npm run ios            # or: npm run android
```

### Scripts

| Command                                   | Does                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| `npm run start`                           | Start the Expo dev server                                 |
| `npm run ios` / `npm run android`         | Start the dev server and open the platform                |
| `npm run lint` / `npm run lint:fix`       | ESLint                                                    |
| `npm run format` / `npm run format:check` | Prettier                                                  |
| `npm run typecheck`                       | `tsc --noEmit`                                            |
| `npm run test` / `npm run test:watch`     | Jest                                                      |
| `npm run wiki:lint`                       | Validate the `knowledge/` LLM Wiki (see docs/LLM_WIKI.md) |
| `npm run verify`                          | lint + typecheck + test + wiki:lint, in that order        |

## Git workflow

- `main` — stable
- `develop` — integration
- `feature/*` — short-lived feature branches

No secrets, `.env` files, keys, or generated build artifacts are committed — see
`.gitignore` and `.env.example`.
