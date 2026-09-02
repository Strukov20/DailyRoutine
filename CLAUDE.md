# CLAUDE.md

Guidance for Claude Code (or another coding agent) working in this repository.

## What this is

FamilyFlow (working name — see `src/config/app-info.json`) is a personal + family planner
for iOS/Android, React Native + Expo + Supabase. Full docs: [`README.md`](README.md) →
[`docs/`](docs/). This repository is currently in its **foundation phase** — see
[`docs/MVP_SCOPE.md`](docs/MVP_SCOPE.md) for exactly what is and isn't built yet.

## Before any non-trivial task: use the LLM Wiki

This repository maintains a persistent knowledge base at `knowledge/` (see
[`docs/LLM_WIKI.md`](docs/LLM_WIKI.md) for the full design). **Use it before editing code**,
not as an afterthought:

1. Read [`knowledge/wiki/index.md`](knowledge/wiki/index.md).
2. Search for concepts relevant to the task: `rg -i "<concept>" knowledge/wiki`. Retrieve
   only what's relevant — don't load the whole knowledge base into context.
3. Read the canonical `/docs` pages linked from whatever wiki pages matched.
4. Check recent entries in [`knowledge/wiki/log.md`](knowledge/wiki/log.md) for related
   history.
5. Identify contradictions or unresolved questions _before_ editing code — don't silently
   pick a side. If code and `/docs` disagree, report it; don't assume the code is right.

**After any material task**, before reporting it done:

1. Decide whether durable project knowledge changed. Skip the rest of this list for
   trivial/formatting-only changes.
2. If it did: add a dated file under `knowledge/raw/sessions/` describing what happened.
3. Update the affected `knowledge/wiki/*` pages (confirmed vs. proposed vs. unresolved —
   don't overwrite a recorded contradiction, add to it).
4. Fix cross-links; update `knowledge/wiki/index.md` if pages were added/renamed/moved.
5. Append an entry to `knowledge/wiki/log.md` (append-only — never edit a past entry).
6. Run `npm run wiki:lint` and fix anything it flags.
7. Mention the wiki changes in your final report to the user.

Sources of truth, highest to lowest: **executed code/tests/migrations** → **approved
`/docs`** → **`knowledge/wiki/`** (synthesis, links to `/docs`, never duplicates it) →
**`knowledge/raw/`** (immutable evidence).

## Git rules

- Branches: `main` (stable), `develop` (integration), `feature/*` (short-lived).
- Never push. Never merge into `main`. Both require explicit user instruction beyond "make
  this change."
- Local commits only when the working tree was clean before starting; use conventional
  commit messages.
- Never commit secrets, `.env` files, API keys, signing certificates, or generated build
  artifacts — see `.gitignore` and `.env.example`.

## Before making changes

1. `git status` — check for uncommitted work; never discard it.
2. If the repo isn't in the state you expect, investigate before acting — see the LLM Wiki
   workflow above; the wiki likely already explains recent history.

## Key rules this codebase enforces (don't reintroduce what was deliberately removed)

- **TypeScript is pinned to 6.0.3, ESLint to 9.39.5** — not "latest." Both are real peer
  dependency conflicts with this project's other tooling, not arbitrary caution. Full
  rationale: [`docs/DECISIONS.md`](docs/DECISIONS.md). Don't bump either without re-checking
  `@typescript-eslint`/`eslint-config-expo` compatibility first.
- **Navigation theming imports from `expo-router`, not `@react-navigation/native`.** The
  direct import passes lint/typecheck but breaks at Metro bundle time. See
  `docs/DECISIONS.md` and run `npx expo export --platform ios` after any navigation/theming
  change — lint and typecheck alone won't catch this class of break.
- **No user-facing string is hardcoded in a component.** Everything goes through
  `react-i18next`'s `t()`, reading from `src/i18n/locales/{en,uk}/*.json`. Add a key to both
  locale files together (see `src/i18n/i18n.test.ts`'s key-parity check).
- **Privacy is a data-layer guarantee, not a UI convention** — see
  [`docs/SECURITY_AND_PRIVACY.md`](docs/SECURITY_AND_PRIVACY.md). Never "fix" a privacy leak
  by hiding a field in the UI; the query itself must not return it.
- **Events and responsibilities are separate records** — never re-add a drop-off/pickup
  field to an event. See [`docs/PRODUCT.md`](docs/PRODUCT.md) and
  `knowledge/wiki/domain/events-and-responsibilities.md`.
- **TanStack Query owns server state; Zustand (`src/store/uiStore.ts`) stays small; auth
  session state lives in `AuthProvider`, not either of those** — see
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), "State-management boundaries."
- **Never call `supabase.auth.*` or raw `supabase.from(...)` from a screen** — go through
  `src/lib/auth/authService.ts` / `useAuth()`, or a future repository/service module. This is
  the transport/domain/UI boundary — see `docs/ARCHITECTURE.md`.
- **Every exposed Supabase table needs RLS policies, explicit grants, and a pgTAP test** —
  see `supabase/migrations/` for the pattern (composite FKs for "same family" checks,
  `current_family_ids()`/`is_family_member()` helpers to avoid recursive RLS) and
  `supabase/tests/` for the test conventions (`docs/TEST_STRATEGY.md`).
- **`render()`/`fireEvent.*()` from React Native Testing Library are async in the installed
  version — always `await` them** in new tests.
- Logging goes through `src/lib/logger/logger.ts`, never bare `console.log`.

## Verification

```bash
npm run verify   # lint + typecheck + test + wiki:lint
```

Also worth running after any navigation, config, or dependency change:
`npx expo export --platform ios`, `npx expo config`, `npx expo-doctor`.

After any schema/RLS change: `npm run db:reset && npm run db:test` (needs the local Supabase
stack running — `npm run supabase:start`, which needs Docker).

## Scope discipline

Check [`docs/MVP_SCOPE.md`](docs/MVP_SCOPE.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md)
before building something new. If a request looks like it belongs to V2/V3, say so and
confirm before implementing it as if it were MVP.
