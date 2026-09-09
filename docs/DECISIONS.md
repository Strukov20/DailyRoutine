# Architectural Decisions

Short ADR-style entries. Newest first is not enforced — entries are grouped by topic instead,
since several were made together during the foundation build.

## Phase 2 (Supabase foundation, schema, RLS, auth)

The entries below were made while implementing `supabase/migrations/` and the auth layer
(`src/lib/auth/`). Several of them **correct or refine** the Phase-1 proposals in
[DATA_MODEL.md](DATA_MODEL.md)/[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) rather than
just implementing them as-is — each says explicitly what changed and why, per this project's
own rule of documenting a required change before applying it.

### Privacy view: not `security_invoker` — this fixes a real gap in the Phase 1 design

**Context found during implementation:** the Phase-1 `SECURITY_AND_PRIVACY.md` proposed a
`security_invoker` sanitized view for Busy blocks. Working through it end to end surfaced a
real contradiction: base-table RLS (correctly) hides a private row from non-owners entirely.
A `security_invoker` view runs _with the querying user's own RLS_, so it would inherit that
same block — no Busy block could ever render for a private item, defeating the view's whole
purpose.

**Decision:** `family_schedule` and `family_task_board` (`supabase/migrations/20260902120800_sanitized_availability.sql`)
are ordinary views (default owner-execution semantics — Postgres views are NOT
`security_invoker` unless explicitly opted in), owned by the migration role. They bypass the
querying user's RLS on the base table by construction, so the view's own `WHERE` clause
(same-family membership) becomes the _sole_ authorization check — reviewed together with the
column-sanitizing `CASE` expressions in one file, so "what a family member may see" has
exactly one definition. `docs/SECURITY_AND_PRIVACY.md`'s Mechanism 2 has been updated to
match. Proven by `supabase/tests/060_privacy_regression_test.sql`.

### Denormalized `family_id` on family-scoped child tables

`task_assignments`, `event_participants`, and `responsibilities` each carry their own
`family_id` column (auto-populated by a `BEFORE INSERT` trigger from the parent
task/event — never trusted from the client), in addition to their existing FK to
`tasks`/`events`. This is an addition to the Phase-1 schema, not a change to the approved
unified `family_members` model.

**Why:** it enables two things that would otherwise need either recursive joins or
per-row-lookup triggers: (1) a **composite foreign key** —
`foreign key (assignee_member_id, family_id) references family_members (id, family_id)` —
that declaratively prevents "assignment to someone outside the relevant family" at the
database level, with no trigger required for that specific check; (2) flat, non-recursive RLS
policies on these tables (`family_id in (select current_family_ids())`) instead of a subquery
that joins through the parent every time.

### Composite-FK "same family" pattern, and its MATCH SIMPLE gap

The pattern above relies on Postgres's default `MATCH SIMPLE` FK semantics: if _any_ column
in a composite FK is `NULL`, the whole constraint is skipped. That means `assignee_member_id
IS NOT NULL AND family_id IS NULL` would silently bypass the FK. Every table using this
pattern (`tasks`, `responsibilities`, `event_participants`) therefore also has an explicit
`CHECK` closing that gap (e.g. `tasks_assignee_requires_family`). Tested directly in
`supabase/tests/040_tasks_and_assignments_test.sql`.

### Family ownership integrity: a validating trigger, not a syncing one

`families.owner_id` is a denormalized pointer to the single `family_members` row with
`role = 'owner'`. Rather than a trigger that _writes_ `owner_id` from `family_members` (which
has a chicken-and-egg ordering problem — the owner's `family_members` row can't be inserted
before the family exists, and the family's `owner_id` can't be derived before the owner's
member row exists), the owner is written explicitly at family-creation time and a `BEFORE
INSERT OR UPDATE` trigger on `family_members` (`assert_family_owner_consistency`) _validates_
that any `role = 'owner'` row's `profile_id` matches `families.owner_id`, raising otherwise. A
partial unique index (`family_id) WHERE role = 'owner'`) separately guarantees at most one
owner row per family. Together these are the DB-level guard against "direct creation of a
second family Owner without an approved ownership-transfer flow." No family-creation RPC
exists yet (family UI is Phase 3 — see docs/ROADMAP.md); until then, only migrations/tests
create `families` rows.

### Task assignment is a SECURITY DEFINER trigger over an append-only log, not a direct UPDATE grant

`tasks.assignee_member_id`/`assignment_status` are never updated directly by clients — there
is no UPDATE grant covering those columns for anyone but the task owner, and the owner's
UPDATE policy covers the whole row, not just those two columns. Instead, every assignment
action (`assigned`/`took`/`accepted`/`declined`/`unassigned`/`reassigned`) is an INSERT into
the append-only `task_assignments` table; a `SECURITY DEFINER` trigger
(`apply_task_assignment_action`) then updates the `tasks` snapshot columns. This means an
assignee never needs direct write access to a task row they don't own in order to accept or
decline an assignment addressed to them — the trigger, not a grant, does that write, and the
RLS policy on `task_assignments` (not `tasks`) is what actually gates who may record which
action. See `supabase/tests/040_tasks_and_assignments_test.sql` for the wrong-user-cannot-accept
and cross-family-cannot-assign cases this is designed to prevent.

### Timezone handling: `timezone` columns on `events`, `tasks`, and `recurrence_rules`

The brief requires `timestamptz` for real instants, explicit local dates where an item has no
time, and IANA timezone identifiers "where local scheduling semantics require them." Applied
as: `events.timezone` is `NOT NULL` (events always have a time, and recurrence/DST
calculations need an anchor); `tasks.timezone` is nullable but required whenever
`tasks.start_time` is set (`tasks_time_requires_timezone` CHECK) — a date-only task has no
ambiguity to resolve; `recurrence_rules.timezone` is `NOT NULL` for the same DST-anchor
reason as events. `tasks.date` stays a plain `date` (no timezone) for the date-only case, per
the brief's explicit "explicit local date" instruction.

### `text` + `CHECK`, not native Postgres `ENUM`, for every status/type/role column

No enum types are used anywhere in `supabase/migrations/`. Native Postgres `ENUM`s are
expensive to evolve — adding a value requires `ALTER TYPE ... ADD VALUE` (which historically
couldn't run inside the same transaction as its first use, and still can't be rolled back),
and removing or renaming a value isn't supported at all short of recreating the type. Given
this product's status/role/type columns (`priority`, `visibility`, `assignment_status`,
`family_members.role`, `responsibilities.type`, etc.) are exactly the kind of thing likely to
grow a new value as the product evolves, `text` + `CHECK (col in (...))` was used everywhere
instead — a `CHECK` constraint can be dropped and recreated with a new value list in one
ordinary migration, no special-cased DDL. This is the "recorded project decision" the brief
asked implementers to follow.

### Authentication session persistence: AsyncStorage, and the trade-off that implies

Continuing the Phase-1 choice (`src/lib/supabase/client.ts`): sessions persist via
`@react-native-async-storage/async-storage`, not `expo-secure-store`. **Trade-off being made
explicitly:** AsyncStorage is not encrypted at rest on the device (SecureStore is, backed by
Keychain/Keystore) — a session token sitting in AsyncStorage is readable by anything with
filesystem access to the app's sandbox (e.g. a rooted/jailbroken device, or a backup
extraction tool). This is accepted because (a) Supabase's own guidance is AsyncStorage for
React Native specifically because session objects routinely exceed SecureStore's ~2KB
per-item limit — SecureStore would silently fail to persist a real session; (b) the access
token is short-lived (`auth.jwt_expiry = 3600`s locally) and auto-refreshed, capping the
exposure window of a leaked token; (c) `expo-secure-store` remains installed and available
for anything genuinely small and sensitive added later. If this trade-off ever needs
revisiting (e.g. a compliance requirement for encrypted-at-rest session storage), the fix is
a hybrid: SecureStore for the encryption _key_, AsyncStorage (or MMKV) for the encrypted
session blob — not a change to `persistSession: true`/`autoRefreshToken: true` themselves.

### Protected routes: `Stack.Protected`, not manual `<Redirect>` checks per screen

`app/_layout.tsx` gates the `(auth)` and `(app)` route groups with `<Stack.Protected guard={...}>`
(Expo Router's built-in guarded-route primitive) rather than each screen/layout independently
redirecting based on `useAuth()`. One root-level guard is the single source of truth for
"which screens are navigable right now," and it re-evaluates automatically whenever
`AuthProvider`'s `status` changes — e.g. completing the email-confirmation deep link flips
`status` to `'signed-in'` and the tree switches itself, with no explicit navigation call
needed anywhere in `app/(auth)/confirm.tsx`.

**One deliberate exception:** `app/reset-password.tsx` lives at the top level, _outside_
both `Stack.Protected` blocks. Exchanging its recovery `code` for a session would otherwise
flip `status` to `'signed-in'` mid-flow and cause the guard to yank the user into the signed-in
app before they've actually set a new password. An always-reachable top-level screen sidesteps
that race entirely rather than trying to special-case it inside the guard condition.

### Google/Apple auth: real API calls, config-gated by an env flag — not a stub

`src/lib/auth/oauth.ts` calls the real `supabase.auth.signInWithOAuth` + `expo-web-browser`
flow — this is functioning code that will work once a provider is enabled with real
credentials in `supabase/config.toml`. What's gated is only whether the sign-in buttons
render at all (`EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`/`EXPO_PUBLIC_AUTH_APPLE_ENABLED`, both
default `false`), and calling either function while disabled throws a `not_configured`
`AuthServiceError` rather than attempting a request that would fail confusingly server-side.
**Manual setup required before flipping either flag to `true`:**

- **Google:** a Google Cloud Console OAuth 2.0 Client ID (Web application type, even for a
  mobile app, since Supabase's OAuth flow is browser-redirect based) with `familyflow://*`
  and `https://<project-ref>.supabase.co/auth/v1/callback` as authorized redirect URIs, then
  set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET` (see `.env.example`) and flip
  `supabase/config.toml`'s `[auth.external.google] enabled = true`.
- **Apple:** an Apple Developer "Services ID" (distinct from the app's own Bundle ID) with
  Sign in with Apple enabled, a private key for it, and the same redirect URI registered in
  the Apple Developer portal; set `SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID`/`_SECRET` and flip
  `[auth.external.apple] enabled = true`. A future enhancement (not built now) is swapping
  the browser-based flow for `expo-apple-authentication`'s native button, which Apple's App
  Store guidelines prefer over a web redirect for this specific provider.

### Docker installed via Homebrew's cache (bypassing an interactive-sudo install failure)

This machine had no Docker (required for `supabase start`/`db reset`/`test db`/`gen types
--local`). Per this task's explicit instruction not to install system-level software without
permission, the user was asked and chose to have it installed. `brew install --cask docker`
downloaded and checksum-verified `Docker.dmg`, but its final step (symlinking
`docker-credential-osxkeychain` into the root-owned `/usr/local/bin`) needs `sudo` with an
interactive password prompt a non-interactive shell can't supply — and Homebrew rolls back
the entire cask install (deletes `Docker.app`) when any postflight step fails, so simply
"finish the last step" wasn't possible after the fact.

**Resolved** by using Homebrew's own already-verified cached `.dmg` directly: mounted it,
copied `Docker.app` into `/Applications` (writable without sudo — the user is in the `admin`
group, which owns `/Applications`), and symlinked the bundled CLI tools into
`/opt/homebrew/bin` (user-writable, already on `PATH`) instead of `/usr/local/bin`. The one
step that's genuinely unavoidable without sudo — Docker Desktop's first-launch privileged
network/virtualization helper, which requires a macOS GUI authorization dialog — was
completed by the user via `open -a Docker` followed by the on-screen prompts.

**Verified working**: `supabase start`, `supabase db reset` (all 9 migrations apply cleanly
from scratch), `supabase test db` (all 88 pgTAP assertions pass), and
`supabase gen types typescript --local` (now the real content of
`src/lib/supabase/types.ts`) all ran successfully against the resulting local stack. Running
migrations for real also surfaced and fixed one real bug (a migration-ordering issue —
`is_family_member()` et al. were defined before `family_members` existed, and PostgreSQL
resolves table references in a `LANGUAGE SQL` function body at `CREATE FUNCTION` time, not
first call as originally assumed) and two pgTAP test-assertion bugs (`anon` has no `GRANT` at
all on these tables, so "anonymous sees zero rows" needed to be `throws_ok(..., '42501', ...)`,
not `is(count, 0)`) — full detail in `knowledge/raw/sessions/2026-09-02-phase2-docker-resolved.md`.

### Supabase client: explicit `flowType: 'pkce'` — supabase-js still defaults to `'implicit'`

Found via live manual testing (not a unit test — no mock would have caught this): a real
sign-up's confirmation email linked to `familyflow://confirm#access_token=...` (an implicit-flow
URL _fragment_), which `app/(auth)/confirm.tsx` — written to read a `?code=` _query_ param and
call `exchangeCodeForSession(code)` — could not parse at all. `@supabase/supabase-js`'s
`flowType` option still defaults to `'implicit'` for backwards compatibility (confirmed by
reading the installed `GoTrueClient.js`), not `'pkce'` as assumed when `confirm.tsx`/
`reset-password.tsx`/`oauth.ts` were originally written. Fixed by setting `flowType: 'pkce'`
explicitly in `src/lib/supabase/client.ts`. Re-verified: the resulting confirmation link now
starts with `token=pkce_...` and redirects to `familyflow://confirm?code=...`.

**Known follow-up, not fixed**: with `flowType: 'pkce'`, supabase-js generates the PKCE code
challenge via SHA-256 when `crypto.subtle` is available, falling back to the weaker `'plain'`
method with a console warning otherwise ("WebCrypto API is not supported"). Confirmed via a
real device console log that Hermes/React Native has no global `crypto.subtle`, so this app
is currently on the `'plain'` fallback — spec-compliant (RFC 7636) and not a functional bug,
but a real reduction in protection against authorization-code interception on mobile (the
exact threat PKCE exists to address, and relevant here given the app uses a custom URL scheme
for its redirect). `expo-standard-web-crypto` was evaluated and rejected — it only polyfills
`crypto.getRandomValues`, not `crypto.subtle`. `react-native-quick-crypto` (JSI-based, used in
Supabase's own React Native guidance for this exact gap) is the likely fix, deferred because
it adds a new native dependency requiring a rebuild, out of scope for an in-session debugging
fix. Should be picked up before this app handles production credentials.

### React Compiler-aware ESLint rules (`react-hooks` v7, via `eslint-config-expo`) surfaced two real issues

Two lint errors appeared that weren't present in Phase 1's simpler components, both from
`eslint-plugin-react-hooks`'s newer React Compiler-aware rules (bundled transitively via
`eslint-config-expo`, not something added this phase):

- `react-hooks/set-state-in-effect` — `app/(auth)/confirm.tsx` and `app/reset-password.tsx`
  originally called `setState` synchronously inside a `useEffect` for the "no `code` param"
  branch. Fixed by moving that branch into the `useState` initializer (lazy initial state)
  instead, so the effect only runs for the actual async exchange.
- `react-hooks/preserve-manual-memoization` — `AuthProvider.tsx`'s `refreshProfile`
  `useCallback` had a dependency array (`[loadProfile, session?.user.id]`) more granular than
  what the compiler's dependency inference expected (`session` as a whole). Simplified to
  depend on `session` directly.

Neither is a stylistic preference — both are the React Compiler's static analysis catching a
pattern that either causes an extra render (`set-state-in-effect`) or produces memoization
the compiler can't safely trust (`preserve-manual-memoization`). Worth knowing this rule set
exists before writing more effect-heavy code.

## Platform & framework

**Expo (managed) + Expo Router, SDK 57.** Chosen per the brief. Expo Router gives file-based
routing, route groups for `(auth)`/`(app)`, and typed routes
(`experiments.typedRoutes: true` in `app.config.ts`) without hand-wiring React Navigation.
Consequence accepted: native code is normally not hand-edited (`/ios`, `/android` stay
git-ignored, generated on demand by `expo prebuild`/EAS) — acceptable for this product, which
has no known need for custom native modules beyond what Expo's SDK covers.

**Target platforms are iOS and Android only.** `app.config.ts` sets
`platforms: ['ios', 'android']` explicitly. Web is not a target (per the brief); enabling it
later would additionally require installing `react-native-web` and is out of scope now — the
`web` npm script was deliberately removed rather than left in a broken state.

## Backend

**Supabase** for Postgres, Auth, Realtime, and Storage, per the brief. `src/lib/supabase/client.ts`
configures the client with `AsyncStorage` (not `SecureStore`) as the auth session storage
adapter — Supabase session objects routinely exceed SecureStore's ~2KB per-item limit, which
is Supabase's own documented reason for recommending AsyncStorage for React Native.
`expo-secure-store` is still installed for small, genuinely sensitive values a later phase
might need (not currently used for anything).

**No production Supabase project is connected.** The client falls back to a syntactically
valid placeholder URL/key when `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY` aren't set, so the app
still boots and screens still render (with real requests failing fast) rather than crashing
at import time. See `src/lib/env.ts` and `.env.example`.

## Data model & privacy

**Events and responsibilities are separate tables** (`events`, `event_participants`,
`responsibilities`), never a text field on an event. This is the "event ≠ responsibility"
rule from the brief; see [DATA_MODEL.md](DATA_MODEL.md) and [PRODUCT.md](PRODUCT.md) for the
full rationale (it's what lets "who has pickup covered" become a query instead of a note).

**Child profiles use a unified `family_members` table** (`member_type: 'adult' | 'child'`)
rather than a separate `children` table. Reasoning: a family's schedule/assignment logic
(events, responsibilities, task assignment) treats adults and children as "a person in this
family" for the vast majority of queries — splitting them into two tables would mean every
one of those joins either duplicates itself per table or goes through a union view anyway.
The nullable `family_members.profile_id` is the seam for "a child profile can be linked to a
real account later" the brief asked for — linking becomes a single `UPDATE`, not a migration.
Consequence accepted: the table has a few columns that are conditionally required depending
on `member_type` (enforced by a `CHECK` constraint at migration time, not by splitting the
table).

**Privacy is a data-layer guarantee, not a UI convention.** RLS on base tables blocks
non-owners from ever selecting a private row; a sanitized view (nulling out sensitive columns
in the query itself) is the only path to another member's data; Realtime broadcasts go
through the same sanitization function rather than re-broadcasting raw rows. Full design in
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). This was written and reviewed before any
migration exists, per the brief's explicit instruction.

## State management

**TanStack Query owns all server state; Zustand is scoped to two fields.** See
[ARCHITECTURE.md](ARCHITECTURE.md), "State-management boundaries," for the rule and its
rationale. This is called out here because it's the kind of boundary that erodes silently if
not stated explicitly up front — "just add it to the UI store, it's easier" is how apps end
up with two disagreeing sources of truth for the same data.

## TypeScript version — pinned to 6.0.3, not the npm-`latest` 7.0.2

**Context:** `npm view typescript version` currently resolves to `7.0.2` — TypeScript's
Go-based rewrite. `@typescript-eslint/eslint-plugin@8.69.0` (the version compatible with the
rest of this project's ESLint/RN tooling) declares a peer requirement of
`typescript: '>=4.8.4 <6.1.0'`, which **excludes 7.0.2**. Confirmed independently: a fresh
`create-expo-app` template itself pins `typescript: ~6.0.3`, not 7.x, for the same reason.

**Decision:** pin `typescript` to `6.0.3` — the newest release inside the range
`@typescript-eslint` actually supports. This was confirmed with the user before scaffolding
(TypeScript 7 was the one clarifying question asked up front, since the brief's "use
mutually compatible stable versions" instruction directly implied resolving this conflict
rather than defaulting to whatever `latest` happened to mean that day).

**Consequence:** revisit this pin once `@typescript-eslint` (or its eventual TS7-native
successor) publishes support for TypeScript 7.x — don't bump blindly.

## ESLint version — pinned to 9.39.5, not the npm-`latest` 10.x

**Context:** `eslint-plugin-react@7.37.5` and `eslint-plugin-import@2.32.0` — both pulled in
by `eslint-config-expo@57.0.2`, the official Expo lint config — declare peer ranges that stop
at `^9.7`/`^9`, i.e. they do not yet support ESLint 10. Installing ESLint 10 produced real
`npm warn ERESOLVE overriding peer dependency` warnings during setup, not just an abstract
version-range mismatch.

**Decision:** pin `eslint` to `9.39.5` (latest in the 9.x line). Same category of decision as
the TypeScript pin above — driven by what the actual dependency graph supports, not by
"newest is best." `eslint-config-prettier@10.x` (used to disable formatting-conflicting
rules) is compatible with ESLint 9, so no further cascade was needed.

## `eslint-import-resolver-typescript` needed an explicit root install

**Context:** `eslint-config-expo`'s flat config sets `import/resolver: { typescript: {...} }`,
which needs the `eslint-import-resolver-typescript` package resolvable _from any linted
file's location_, not just from inside `eslint-config-expo`'s own `node_modules`. Because npm
nested it there instead of hoisting it, ESLint's module resolver fell back to resolving the
literal string `"typescript"` (the compiler package, not the resolver) and failed with
`typescript with invalid interface loaded as resolver`.

**Decision:** install `eslint-import-resolver-typescript@3.10.1` explicitly as a root
devDependency, pinned to the same major version already vetted by `eslint-config-expo`. Root
cause and fix confirmed by directly inspecting `eslint-module-utils/resolve.js`'s resolution
fallback order rather than guessing from the error string alone.

## `react-dom` pinned to `19.2.3` to unblock `expo-router` install

**Context:** `expo-router@57.0.18` pulls in web-only tooling (`@expo/ui`, `vaul`,
`@radix-ui/*`) that depends on `react-dom` — npm resolved the newest `react-dom` (`19.2.8`),
which peer-requires `react@^19.2.8`, conflicting with the project's `react@19.2.3` (itself
matching `react-native@0.86.3`'s own peer requirement of `react@^19.2.3`).

**Decision:** install `react-dom@19.2.3` explicitly (its own peer requirement is exactly
`react@^19.2.3`), resolving the conflict without touching the RN-mandated React version.

## Navigation theming imports from `expo-router`, not `@react-navigation/native`

**Context:** with `@react-navigation/native`'s `ThemeProvider`/`DefaultTheme`/`DarkTheme`
imported directly (the "normal" React Navigation pattern used before Expo Router 6), the app
_passed lint and typecheck_ but **failed to bundle**: `npx expo export` threw "As of SDK 56,
expo-router is no longer compatible with react-navigation." This was caught by a Metro export
smoke test (`npx expo export --platform ios`), not by lint/typecheck — worth remembering,
since it's the kind of break static analysis alone won't catch.

**Decision:** import `ThemeProvider`, `DefaultTheme`, `DarkTheme` from `expo-router` and the
`Theme` type from `expo-router/react-navigation` — Expo Router vendors and re-exports the
React Navigation primitives it wraps internally, version-locked to what it actually ships.
`@react-navigation/native` was removed as a direct dependency once nothing imported it
directly anymore.

**Consequence for CI:** `.github/workflows/ci.yml` includes `npx expo config` and
`npx expo-doctor` in addition to lint/typecheck/test, precisely because this class of failure
is invisible to the other three.

## Icons — `@expo/vector-icons`, not `react-native-vector-icons`

React Native Paper's default icon resolution falls back to the (now deprecated, per its own
npm publish warning) `react-native-vector-icons` package. `ThemeProvider.tsx` instead passes
`PaperProvider`'s `settings.icon` prop, backed by `@expo/vector-icons`'s
`MaterialCommunityIcons` (Expo's actively maintained fork/wrapper), so no deprecated package
is a runtime dependency.

## Zod v4 — `z.email()`, not the deprecated `.email()` string method

`src/domain/auth/schemas.ts` uses the top-level `z.email()` combinator via `.pipe(...)`
rather than the chained `z.string().email()`, which Zod v4's own type definitions mark
`@deprecated` in favor of the top-level form.

## Testing library matchers — no separate `@testing-library/jest-native`

`@testing-library/react-native@14.x` auto-extends Jest's `expect` with the DOM-style matchers
(`toBeOnTheScreen()`, etc.) via its own entrypoint (`dist/index.js` requires
`./matchers/extend-expect` directly) — confirmed by reading the installed package, not
assumed. `@testing-library/jest-native` (a separate package many older tutorials still
reference) is unmaintained/merged and was deliberately not installed.

## `render`/`fireEvent` are async in RNTL 14 — tests must `await` them

`@testing-library/react-native@14`'s `render()` and `fireEvent.press()` (etc.) return
`Promise`s (confirmed from the shipped `.d.ts` files, not from a lint error alone — ESLint's
`@typescript-eslint/no-floating-promises` is what surfaced this during setup). Every test in
this repo `await`s `render(...)` and `fireEvent.*(...)`; new tests should follow the same
pattern rather than reintroducing floating promises.

## `jest.config.js` does not override `transformIgnorePatterns`

An initial hand-written `transformIgnorePatterns` regex (assembled from older
Expo/React-Native tutorials) broke on `standard-navigation`, a package `expo-router`
transitively depends on that ships untranspiled source. `jest-expo`'s own preset already
maintains a `transformIgnorePatterns` tuned to the exact installed SDK version (confirmed by
reading `node_modules/jest-expo/jest-preset.js`), including `standard-navigation` already.
**Decision:** don't set this key in `jest.config.js` at all — let the preset supply it.

## Environment & config

**`app.config.ts`, not `app.json`.** Lets native config and in-app UI both read the product
name from one JSON file (`src/config/app-info.json`) — see [ARCHITECTURE.md](ARCHITECTURE.md).
`app.config.ts` is loaded by a bare `require()`, which cannot resolve sibling `.ts` modules
(confirmed by hitting `Cannot find module './src/config/appInfo'` when the shared config was
first written as `.ts`) — hence the JSON file, not a TypeScript module, as the shared source.

**`EXPO_PUBLIC_*` env vars, validated with Zod at startup**, per `src/lib/env.ts`. A missing
or malformed variable fails loudly and immediately with a clear message, instead of
surfacing later as an opaque error inside a Supabase call.

## Error handling & logging

A single `src/lib/logger/logger.ts` abstraction is the only sanctioned logging path (ESLint's
`no-console` rule allows only `warn`/`error` directly) so a real sink can be swapped in later
by editing one file, and so the "never log private content" rule
(SECURITY_AND_PRIVACY.md) has one enforcement point instead of many call sites to audit.

## Phase 3 (Family Space, invitations, family members, child profiles)

The entries below were made implementing `supabase/migrations/20260903120000_family_management.sql`,
`src/lib/family/`, `src/domain/family/`, and `app/family/*` / `app/invite/[token].tsx`. Phase 3
began with a security regression audit of the Phase 2 sanitized views and RLS (per this
project's own rule of auditing before extending) — the audit's findings and their fixes are
recorded first, since they shaped everything built afterward.

### Audit finding: `anon` had `EXECUTE` on every function via Supabase's default privileges

Every Phase 2 `SECURITY DEFINER` helper (`is_family_member`, `is_family_owner`,
`current_family_ids`) — and, before this fix, every new Phase 3 RPC — carried
`revoke all on function ... from public; grant execute ... to authenticated;`, which reads as
"only `authenticated` can call this." Inspecting `pg_proc.proacl` on a real local instance
showed `anon=X/postgres` on all of them anyway. Root cause: Supabase's local/hosted Postgres
runs `alter default privileges in schema public grant execute on functions to anon,
authenticated, service_role` as part of its own role bootstrap, which grants `anon` and
`authenticated` EXECUTE **directly**, as separate ACL entries from the `PUBLIC` pseudo-role —
`revoke ... from public` only removes the `PUBLIC` entry, never those two.

For the three Phase 2 helpers this was harmless in practice (`auth.uid()` is `null` for
`anon`, so each one safely returns false/empty), but for two of this phase's own new RPCs it
was not: `get_family_invitation_preview` has no internal auth check by design (a preview
doesn't need to know who's asking), so `anon` could preview any guessed/leaked token with
zero authentication; `decline_family_invitation` never checks `auth.uid()` either (declining
doesn't need to), so `anon` could decline someone else's pending invitation as a griefing
vector. **Decision:** every `revoke all on function ... from public` in this codebase should
really read `revoke all on function ... from public, anon` — fixed for both the new functions
and, retroactively via a new statement in the Phase 3 migration (not by editing the shipped
Phase 2 file), for the three Phase 2 helpers. See
`supabase/migrations/20260903120000_family_management.sql`'s opening comment for the full
writeup, and `supabase/tests/080_family_management_test.sql`'s final two assertions (and the
real-user curl verification in Section 14 of the Phase 3 report) for how this was proven
fixed, not just asserted fixed.

### `family_invitations`: hashed one-time tokens, not the invitee's email

Phase 2 shipped `family_invitations` with an `invited_email`-matching RLS policy: an invitee
could `SELECT` their own pending invitation once their JWT email matched. That model assumed
delivery by email to a known address. Phase 3 has no email provider (see below), so
invitations are delivered as a shareable link — which needed to work for a link forwarded
through any channel, not just an email-verified session. **Decision:** add a `token_hash`
column (SHA-256 hex digest — `sha256()` on `bytea` is a core Postgres builtin since v13, so no
`pgcrypto` dependency was added just for this), generate the raw token from two concatenated
`gen_random_uuid()` values (244 bits of randomness) inside `create_family_invitation`, return
it to the caller **exactly once**, and never store or log it anywhere. `invited_email` stays
on the table as the owner's own record of who they meant to invite, but no longer grants
access — the invitee-by-email SELECT policy is dropped entirely, and every invitee-facing
operation (`get_family_invitation_preview`, `accept_family_invitation`,
`decline_family_invitation`) is validated purely by token possession + status + expiry, never
by comparing the caller's email. As defense in depth, `token_hash` is also excluded from the
column-level `SELECT` grant on `family_invitations` — nothing in the app ever needs to read it
back, so it is simplest not to expose it at all, even hashed.

### No email provider yet — link/Share/copy-link delivery only

Sending real email (a transactional-email provider, DNS/SPF/DKIM setup, template design) is
out of scope for this phase (see [ROADMAP.md](ROADMAP.md)). `create_family_invitation` returns
a `familyflow://invite/<token>` deep link (`src/lib/family/inviteLink.ts`); the owner shares it
through the native Share sheet or a copy-link button (`app/family/invite.tsx`) via whatever
channel they already use. This is why invitation acceptance is token-only rather than
email-verified (previous entry) — the app has no way to prove the recipient controls
`invited_email` without an email provider to send to it.

### `get_family_invitation_preview` requires authentication — deliberately, not by omission

Unlike `create_family_invitation`/`accept_family_invitation`/etc., the preview RPC has no
business-logic reason to check `auth.uid()` — a token's validity doesn't depend on who is
asking. It would be technically possible to let `anon` call it. **Decision:** require
`authenticated` anyway, consistent with the rest of the app (every screen requires sign-in
first — see `app/_layout.tsx`'s `Stack.Protected` guards), and to avoid a fully unauthenticated
token-probing surface with no Supabase Auth audit trail at all. The practical protection is
still the token's 256-bit-scale randomness either way; this is defense in depth, not the
primary control. See the "anon had EXECUTE" finding above for why this had to be explicitly
re-verified rather than assumed to already be true.

### `families`/`family_members` still have no direct write grant — RPC-only, unchanged from Phase 2

Phase 2 deliberately left `families`/`family_members` without an `INSERT`/`UPDATE`/`DELETE`
grant for `authenticated` (beyond the single owner-rename case), anticipating that family
creation and roster changes would need business-rule enforcement (owner-orphan prevention,
child-only fields, cross-family checks) that RLS alone expresses awkwardly. Phase 3 keeps that
boundary and adds `create_family_with_owner`, `create_child_profile`, `update_child_profile`,
and `remove_family_member` as the only ways to write these tables. The two `for all` policies
this made dead (`family_members_owner_manages_roster`, `family_invitations_owner_manages`) are
dropped in the Phase 3 migration for clarity — they never matched anything even before this
phase, since no grant ever existed for them to combine with.

### Owner-orphan prevention: `remove_family_member` refuses to ever remove the `role = 'owner'` row

A family with zero owners would be unrecoverable under this schema (every mutating RPC checks
`is_family_owner`). `remove_family_member` raises `22023` unconditionally if asked to remove
the owner row, regardless of who's asking. **Deferred, not solved:** ownership transfer (an
owner handing the role to another adult) and "the owner leaves the family" have no RPC this
phase — see [ROADMAP.md](ROADMAP.md). An owner who wants to stop using a family today has no
supported way to do that other than removing every other member and leaving the family
itself intact but unused; this is a known, accepted gap for the MVP, not an oversight.

### Child profiles: any adult member may create/update; only the owner may remove

Creating or editing a child profile (`create_child_profile`/`update_child_profile`) only checks
`is_family_member` — any adult (owner or adult role) can manage children, matching how
multiple parents/guardians in one family would actually use this. Removing _any_ member,
child included, is owner-only (`remove_family_member`), for the simpler reason that Phase 2
already established "roster changes are owner-only" as the default and Phase 3 saw no product
requirement strong enough to carve out an exception for children specifically. Child rows never
carry a `profile_id` this phase (unlinked by construction — see the `create_child_profile`
migration comment), so they cannot be discovered or contacted independently of the family that
created them.

### Multi-family support: TanStack Query owns the list, Zustand owns only the selection

A user may belong to several families. `src/domain/family/hooks.ts`'s `useMyFamilies` (and the
`familyKeys` query-key scheme built on it) is the only source of truth for _which families
exist and what's in them_ — `useUIStore.activeFamilyId` (already scaffolded in Phase 1) holds
only _which one the UI is currently showing_, exactly as `docs/ARCHITECTURE.md`'s
state-management boundary already specified. `useActiveFamily()` is the one place that
reconciles the two: it falls back to the first family when the stored preference doesn't
refer to a family the user is actually in (e.g., they were removed from it elsewhere), and
persists that fallback back into the store rather than only returning it — see its Jest tests
in `src/domain/family/hooks.test.tsx`.

### Invitation deep link is a top-level route, and `pendingInviteToken` is a small, deliberate Zustand exception

`app/invite/[token].tsx` sits outside both `Stack.Protected` groups in `app/_layout.tsx` (like
`reset-password.tsx`/`auth-callback.tsx`), so it renders regardless of auth status. A
signed-out visitor who opens the link has no session yet and must sign up/in first — but the
existing sign-in/sign-up screens navigate purely via the implicit `Stack.Protected` swap on
`status` change (see their own comments), with no mechanism to carry a param through that
flow. **Decision:** stash the token in a new `pendingInviteToken` field on `useUIStore` when a
signed-out visitor opens the invite screen, and let a small effect in `app/_layout.tsx`'s
`RootNavigator` redirect to `/invite/<token>` the moment `status` becomes `'signed-in'`,
clearing the field immediately after. This is `uiStore`'s only Phase 3 addition beyond
`activeFamilyId`, and it fits the same "genuinely UI-only, no server owner" test — it's not
persisted (no persist middleware on this store), which is the right lifetime for a value that
should not survive an app restart.

## Phase 4 (Personal Tasks, Inbox, Today, Tomorrow)

The entries below were made implementing
`supabase/migrations/20260904120000_personal_task_management.sql`, `src/lib/tasks/`,
`src/domain/tasks/`, `src/lib/categories/`, `src/domain/categories/`, and
`app/(app)/{inbox,today}.tsx` / `app/tomorrow.tsx` / `app/task/**`. Like Phase 3, this began
with a security audit of the existing task-related schema before writing any application code.

### Audit finding: `tasks` granted raw `INSERT`/`UPDATE`/`DELETE` to `authenticated`

The Phase 2 `tasks_update_own` policy's `WITH CHECK` only pinned `owner_profile_id =
auth.uid()` — nothing stopped a client from directly rewriting `family_id`,
`assignee_member_id`, or `assignment_status` on their own task via a plain `PATCH`, bypassing
the `task_assignments` audit trail entirely, and nothing revalidated `is_family_member` on
`UPDATE` the way the `INSERT` policy did (an owner could set `family_id` to a family they
don't belong to, and — since the sanitized-view WHERE clause only checks the _viewer's_
membership, not the _owner's_ — that family's real members would then see the task on
`family_task_board`). **Decision:** revoke `INSERT`/`UPDATE`/`DELETE` on `tasks` entirely and
replace every mutation with the seven RPCs this migration adds (see below), continuing the
Phase 3 RPC-only pattern rather than trying to patch the policy. `SELECT` stays a direct,
RLS-governed table read (reads are already safe and don't multiply into a business-invariant
problem the way writes did). The one existing pgTAP assertion this changed
(`040_tasks_and_assignments_test.sql`'s cross-family-assignee-via-UPDATE test) now expects
`42501` instead of `23503` — a strictly stronger guarantee (no field at all can be written via
`UPDATE`, not just that specific one), documented inline at the change site.

### Two new CHECK constraints, additive to Phase 2's

`tasks_time_requires_date` (`start_time is null or date is not null`) and
`tasks_duration_minutes_bounded` (replacing the old unbounded `> 0` check with `> 0 and <=
1440`) close two real gaps: a task could previously have a start time with no date at all
(ambiguous — which day does that time belong to?), and duration had no upper bound. Both are
table-level constraints, not re-implemented per-RPC, so they hold regardless of write path.
**Not changed**, on purpose: `DATA_MODEL.md` already documents `visibility = 'family'` with
`family_id IS NULL` as an intentional "ignored, not invalid" state (also reconfirmed via
`family_task_board`'s own `WHERE family_id IS NOT NULL` clause, which already makes that
combination inert) — no constraint was added against it, since doing so would silently
override a prior, deliberate design decision rather than close an audit gap.

### Soft delete: `tasks.deleted_at`, not a status column

`docs/DATA_MODEL.md` had no delete/archive story for tasks yet. Per this phase's own brief
("prefer soft deletion using an approved field such as `deleted_at`"), added `deleted_at
timestamptz` and folded `deleted_at is null` directly into the `tasks_select_owner_or_family_visible`
RLS policy and into `family_task_board`'s `WHERE` clause — an archived task disappears from
every normal read path **including the owner's own**, not just from a client-side filter, and
including the sanitized family view. `delete_or_archive_personal_task` is the only way to set
it (idempotent — archiving an already-archived task is a no-op, not an error) and there is no
undelete/unarchive RPC or UI this phase — a deliberate, explicit scope trim ("Do not add
permanent deletion UI unless explicitly documented"), not an oversight; see
[ROADMAP.md](ROADMAP.md) for the "trash view" it would take to change that.

### Seven personal-task RPCs, each with one clear responsibility

`create_personal_task` (accepts the full optional field set, including an initial schedule —
covers both "quick add" and "full create" in one call), `update_personal_task` (content fields
only: title/description/priority/category/visibility/family_id — unsupplied parameters leave
the field unchanged, matching "editing does not overwrite unchanged fields"; `description`/
`category_id` use an explicit clear flag, same pattern as `update_child_profile`'s
`p_clear_avatar` in Phase 3, because `null` already means "unchanged" for them),
`complete_personal_task`/`restore_personal_task` (both idempotent — a repeat call is a no-op,
not an error), `schedule_personal_task` (requires `date`; wholesale-replaces
`start_time`/`duration_minutes`/`timezone` rather than merging them, so "Today, Anytime" →
"Today, 14:00 for 30m" → "Tomorrow, Anytime" is always a clean atomic state with no stale
leftover field — also how "move to Today"/"move to Tomorrow" and manual reschedule are all the
same RPC, the client just picks the date), and `move_task_to_inbox` (clears all four
scheduling fields). None of the seven ever accepts `owner_profile_id`, `assignee_member_id`,
or `assignment_status` as a parameter — not merely unvalidated, structurally absent from every
function signature.

### `create_custom_category`: closes a Phase 2 dead-policy gap

`categories_family_owner_manages_custom`, from Phase 2, was a `for all` policy with zero
backing grant — the exact dead-policy pattern Phase 3 already found and fixed for
`family_members`/`family_invitations`. Custom category creation never actually worked before
this RPC. Owner-only, mirroring the family-administrative-action convention already
established for invitations/child profiles.

### Category identity: `color_token`, never `name`

A system category's localized label is looked up via `common:category.<colorToken>`
(`src/components/tasks/CategoryBadge.tsx`) — `name` (stored as plain English, e.g. `'Work'`,
in `supabase/seed.sql`) is shown only for a _custom_ category, which has no translation key by
definition. This is the concrete implementation of "don't store localized display text as the
immutable category identity."

### Date-only tasks: a dependency-free, UTC-round-trip-free utility module

`src/domain/tasks/dateUtils.ts` never calls `new Date(dateOnlyString)` or
`date.toISOString()` — both interpret/emit as UTC midnight, which is a different calendar day
from local midnight in any non-zero-offset timezone (the exact bug class this phase's brief
calls out by name). Every function instead builds/reads a `Date` via the local 4-argument
constructor and local getters (`getFullYear`/`getMonth`/`getDate`), which by construction never
depends on UTC conversion at all — and "YYYY-MM-DD" strings are compared lexicographically
rather than parsed back into `Date` objects at all where possible
(`compareDateOnlyStrings`/`isOverdue`). **A real environment quirk found while testing this**:
`process.env.TZ` reassignment at runtime reliably changes `Date`'s local-time output in plain
Node (confirmed via `node -e`), but does **not** reliably do so inside this project's
`jest-expo` test environment. Since every function here takes its "now" as an explicit
already-local `Date` rather than reading ambient timezone state, this doesn't affect
correctness — but it means `src/domain/tasks/dateUtils.test.ts`'s per-zone test wrappers are
there to guard against a _future_ implementation that does start reading ambient state, not
because today's implementation needs them to pass. Don't assume a `process.env.TZ` trick will
work for verifying other timezone-dependent code in this test environment without checking
first.

### Optimistic UI: completion only, with deterministic rollback

Per `docs/ARCHITECTURE.md`'s rule ("optimistic completion may be used only with deterministic
rollback, duplicate-tap prevention, and tests for server failure"), only
`complete_personal_task`/`restore_personal_task` are optimistic
(`src/domain/tasks/hooks.ts`) — `onMutate` snapshots every currently-mounted task-list query,
patches the target task in place, and `onError` restores the exact snapshot on failure (tested
in `src/domain/tasks/hooks.test.tsx`, including the failure-rollback case). Create, update,
schedule, move-to-inbox, and delete all wait for server confirmation with no optimistic
update — per that same rule, since none of them has a trivially safe rollback the way toggling
a boolean-shaped field does. Duplicate-tap prevention for completion is at the component level
(`TaskRow`'s `isTogglingComplete` prop disables the checkbox while its mutation is in flight);
for quick-add creation, `QuickAddInput` guards re-entrancy with its own `isPending` check
before calling `mutate` (`useMutation` does not dedupe concurrent `mutate()` calls on its own).

### Query invalidation scoped to four keys, not the whole cache

`invalidateTaskLists()` (`src/domain/tasks/hooks.ts`) invalidates exactly Inbox, today's
overdue bucket, and the `forDate` queries for today and tomorrow — the only lists this phase's
UI actually mounts — rather than a blanket `invalidateQueries({ queryKey: ['tasks'] })`, per
`docs/ARCHITECTURE.md`'s "query invalidation limited to affected lists." The one gap this
leaves: a manual reschedule to some date other than today/tomorrow has no mounted list to
invalidate, since no screen shows an arbitrary date this phase — not a bug, just nothing to
keep fresh yet.

### Native pickers added, on-device testing deferred (same situation as Phase 3's clipboard)

`@react-native-community/datetimepicker` (date/time fields in the task editor) and
`@react-native-community/netinfo` (the offline banner, and TanStack Query's `onlineManager`
wiring — see `src/lib/query/onlineManager.ts`, the official React Native integration recipe)
were both added via `npx expo install`. Both are real native modules requiring a native
rebuild before they're testable on a simulator/device — not done this session, same situation
as `expo-clipboard` in Phase 3. `datetimepicker` additionally needed its Expo config plugin
added by hand to `app.config.ts` (the `expo install` command couldn't write to the dynamic
TypeScript config automatically).

## Phase 5 (Shared Family Tasks, assignment workflow, and native Maestro E2E foundation)

### Member removal: soft delete (`family_members.removed_at`), not a hard `DELETE`

`task_assignments.assigned_to_member_id`/`assigned_by_member_id` are `NOT NULL` and the table
is append-only audit history, and none of the FKs referencing `family_members` specify
`ON DELETE` (defaulting to `NO ACTION`). Hard-deleting a `family_members` row that any
assignment history references raises a raw FK violation — a real bug the Phase 4 `remove_family_member`
implementation had, just never exercised until shared tasks created assignment history. Fixed
by adding `family_members.removed_at timestamptz`, having `remove_family_member` set it instead
of deleting the row, and updating `is_family_member`/`is_family_owner`/`current_family_ids` plus
the `family_schedule`/`family_task_board` views' inline subqueries to filter
`removed_at is null`. `supabase/tests/080_family_management_test.sql`'s "removed child row is
gone" assertion was updated to assert `removed_at is not null` instead of a row-count of zero.

### `set_task_assignment`: an internal helper with zero grants, not just `revoke ... from public`

`assign_family_task` and `reassign_family_task` share almost all of their authorization/state
logic, factored into `set_task_assignment(p_task_id, p_assignee_member_id, p_action)`. That
function is `security definer` but has **no `grant execute` to any role at all** — not even
`authenticated` — confirmed via `pg_proc.proacl`. It's callable only function-to-function from
the two thin wrappers (same schema, same owner, no grant needed for that), never directly via
PostgREST. This repeats — and this time was self-caught before shipping — the Phase 3 lesson
that Supabase's role bootstrap grants `EXECUTE` to `anon`/`authenticated` directly at
function-creation time, separate from `PUBLIC`: the first draft of this migration was missing
its `revoke all ... from public, anon, authenticated` line for this function specifically.

### `40001` (serialization_failure) repurposed as "stale/already-resolved state conflict"

Every state-changing shared-task RPC (`take_family_task`, `accept_task_assignment`,
`decline_task_assignment`, `assign_family_task`/`reassign_family_task` via
`set_task_assignment`) locks the task row with `select ... for update` and raises `40001` when
the caller's assumed prior state no longer holds (task already taken, assignment already
resolved, reassigning an unassigned task). Mapped client-side to `TaskErrorCode = 'conflict'`
(`src/lib/tasks/taskService.ts`) and a dedicated `tasks:errors.conflict` message ("this task's
assignment just changed — pull to refresh") rather than the generic "something went wrong,"
since the correct recovery action is specifically a refresh, not a blind retry. pgTAP proves
each RPC's conflict path sequentially (a second call after the first commits); true concurrent
transactions are out of scope for pgTAP (single transaction, sequential) and are deferred to
the real backend integration script (Section 16 of the Phase 5 brief).

### Shared task editor: one form, gated by a `sharedFamilyId` prop, not a second component

`TaskEditorForm` (`src/components/tasks/TaskEditorForm.tsx`) gained an optional
`sharedFamilyId` prop rather than a parallel `SharedTaskEditorForm`. When set: the
Private/Family visibility toggle is replaced with a static notice (a shared task must never
show a Private option that would trip `update_personal_task`'s "can't go Private while
assigned" guard), and — create mode only — an optional Adult assignee picker appears, backed
directly by `create_shared_family_task`'s `p_assignee_member_id` (not a separate
`create`-then-`assign` call, avoiding a partial-failure window). Edit mode never offers the
assignee field at all: reassigning an existing shared task is a board action
(Take/Assign/Reassign/Unassign), routed through the state-machine RPCs, not something the
generic edit form should be able to bypass.

### Custom-category creation: wired into the shared task editor, owner-only, not a new screen

Phase 4 shipped `create_custom_category` (family-owner-only, per its own `is_family_owner`
check) with zero UI call sites — the contradiction this phase's brief asked to resolve. The
RPC itself was correct and already family-scoped; only the UI was missing. Resolved by adding
a "+ New category" item to the shared task editor's existing category `Menu`, gated on
`callerMember?.role === 'owner'` to match the RPC's own authorization rather than showing an
affordance that would just fail server-side for a non-owner adult. Deliberately not a
standalone "manage categories" screen — out of scope for what this phase's brief asked for
(shared-family-task needs only), and nothing else in the app creates categories yet.

### `FamilyTaskBoard`'s `SectionList`: tests mock the list, production code is untouched

Rendering `FamilyTaskBoard` in Jest with tasks spread across all five sections initially only
showed the first section or two — `SectionList` (built on `VirtualizedList`) only expands its
render window in response to real `onLayout`/scroll events, which never fire under
`react-test-renderer` (no native layout engine backing the test environment). Confirmed by
direct experiment that this is a hard cutoff, not a slow-render timing issue: waiting 8 real
seconds via `waitFor` did not surface the missing content. The first fix attempt
(`initialNumToRender={50}` on the production `SectionList`) was **reverted** — it only existed
to satisfy Jest, would force a heavier synchronous initial render for a genuinely large board
for no real benefit (RN's default of 10 already expands correctly via real scroll events on an
actual device), and the user explicitly asked for it to be removed if that was its only
justification. The real fix lives in the test file instead:
`src/components/tasks/FamilyTaskBoard.test.tsx` mocks `react-native/Libraries/Lists/SectionList`
(the specific source module, not the top-level `react-native` package — mocking the whole
package broke jest-expo's own native-module setup, e.g. `TurboModuleRegistry.getEnforcing`
failures for `DevMenu`) with a version that renders every section and row unconditionally. This
keeps the test asserting our own bucketing/wiring logic (meaningful, ours to get right) rather
than re-proving `VirtualizedList`'s windowing (a well-tested RN library concern, and not
something `react-test-renderer` can meaningfully verify anyway, with or without a mock).

### Known technical debt: a single-file `jest` invocation can crash/hang on teardown; the full suite does not

Running one test file in isolation (`npx jest path/to/File.test.tsx`, with or without
`--runInBand`) reliably hangs indefinitely with no output once the tests themselves have
already completed and passed — confirmed via `script -q` (to defeat Node's non-TTY stdout
buffering, which otherwise hides all Jest output until process exit and made this look like a
pre-render hang before it was properly investigated). `npm test` (the full suite, 28 files)
completes normally every time, with only a benign "a worker process has failed to exit
gracefully... force exited" notice — Jest's own worker-pool teardown kills those child
processes regardless of open handles inside them. A single/few-file invocation appears to run
in Jest's main process with no such external killer, so it just hangs forever.

Root-caused via bisection (`AppThemeProvider` alone: clean exit; bare `QueryClientProvider`
alone: clean exit; `QuickAddInput` — which uses `react-native-paper`'s `TextInput`/`IconButton`
— mounted with both: **crashes**, not hangs, with `ReferenceError: You are trying to
`import` a file after the Jest environment has been torn down`, thrown from inside
`react-native-paper`'s `TextInput` lazily constructing `React.useRef(new Animated.Value(...))`).
The stack shows this firing from `Immediate._onImmediate` — a `setImmediate` callback
React 19's concurrent scheduler queues via `recursivelyFlushAsyncActWork`/`flushActQueue` to
finish flushing `act()` work _after_ the test function itself has already returned and Jest has
begun tearing down that file's module registry. In a full-suite run this callback apparently
still fires before its own worker process is reaped; in an isolated single-file run there's
nothing forcing an equivalent wait, so the environment teardown and the deferred callback race,
and the deferred callback loses.

This is a framework-level interaction (React 19's async `act()` flush queue × `react-native-paper`'s
lazy `Animated.Value` construction × Jest's per-file process lifecycle) — not fixable from
individual test code, and not a real leaked resource in the sense `--detectOpenHandles` is
built to find (it reported nothing across multiple runs, consistent with the culprit being a
scheduled callback rather than a standard timer/socket handle). **Do not add `--forceExit` to
`npm test`, `npm run verify`, or CI** — it would silently paper over a real future regression in
this area. Treat it as: single-file/`-t`-filtered ad hoc runs during development may need a
manually-appended `--forceExit` to get a prompt back (safe to do by hand, one-off, never
committed to a script), but the full suite is the source of truth and needs no such flag. See
`docs/TEST_STRATEGY.md`'s "slow-to-report" note, which describes the same family of symptom
from Phase 4 and should be read together with this entry.

### Real multi-user backend integration: 32/32 checks against a live local stack

Beyond pgTAP (which simulates callers via `set local role`), Phase 5 ran an ad hoc bash + curl +
jq script against a real local Supabase stack with two real `auth.users` accounts (admin-API
created, `email_confirm: true` — local email confirmation is on, so the public signup flow can't
produce a usable account) plus a genuine third-party outsider account and an anonymous request.
Not committed (matches the Phase 3/4 precedent of an ad hoc verification script), but every check
it ran is worth recording since it's the closest thing to a real client in this phase: family
creation/invite/accept, shared task creation, assign/accept/decline, **concurrent** Take Task (real
parallel `curl` requests racing the same row, not a simulated conflict), self-target and
other-target reassignment, completion/restore, member removal resolving assignments across
multiple tasks simultaneously, privacy isolation (outsider + anonymous), and full audit-trail
validation (append-only, exact expected sequence:
`assigned,accepted,accepted,reassigned,accepted,unassigned`). All 32 checks passed. Along the way
this surfaced three script bugs (all in the _test_ script, not the app) worth remembering: a bash
subshell-scoping trap (a variable set inside a function invoked via `$(...)` command substitution
is lost in the parent shell — fixed by writing to a temp file and reading it back), `void`-returning
RPCs (`take_family_task`) respond HTTP 204 not 200, and self-reassignment collapses into a single
`accepted` audit row rather than a separate `reassigned`+`accepted` pair (the same
self-assign-immediate-accept shortcut used elsewhere in the assignment state machine, exercised
correctly once the script added a genuine non-self reassignment step).

### Maestro E2E: installed 2.10.0 user-scoped, three flows, `npm run e2e:seed` / `e2e:ios`

Maestro CLI 2.10.0, installed via the official curl installer to `~/.maestro/bin` (no sudo). Its
JVM dependency was installed via the Homebrew **formula** `brew install openjdk`, not `--cask
temurin` (which requires sudo). macOS ships a `/usr/bin/java` stub that exists on `PATH` but errors
at runtime with no real JDK behind it, so `command -v java` can't detect a missing JDK —
`scripts/e2e-ios.sh` always points `JAVA_HOME` at the Homebrew formula's JDK unless the caller
already set one.

Three flows under `.maestro/` run against the iOS Simulator (iPhone 17 Pro, iOS 26.5): personal
task smoke (sign in → quick-add → schedule for today → complete → restore), family task workflow
(User A creates an unassigned shared task → signs out → User B takes and completes it), and
assignment decline (User A assigns to User B → User B declines → User A sees it back unassigned
after a fresh sign-in). Each achieved two consecutive fully clean, unattended runs (every command
`COMPLETED`, verified against `manifest.json`/`commands.json`, not just the terminal summary) by
the end of this phase, plus direct confirmation against the database that each flow's real backend
outcome matched what the UI showed (exact task/assignment rows queried after each run).

`scripts/e2e-seed.sh` provisions two Maestro users (`maestro-user-a@familyflow.test`,
`maestro-user-b@familyflow.test`, both `Maestro1234`) in one shared family via the same admin API +
RPC pattern as the backend integration script, and additionally writes their `family_members.id`s
to the **gitignored** `.maestro/.env.local` (`.env*.local` is already ignored) — see "Assignee
picker" below for why a member id, not a display name, is the only thing that can target a specific
member reliably. `scripts/e2e-ios.sh` reads that file and forwards each value to `maestro test` via
repeated `-e KEY=value` flags, which the flows reference as `${KEY}`. New npm scripts: `e2e:seed`,
`e2e:ios`.

The rest of this section records what every flow had to work around, in the order discovered —
each is real, evidenced (via `maestro hierarchy`'s live accessibility-tree dump, screenshots at the
exact failure instant, and/or direct database queries), and either fixed at the root cause or
documented as unresolved technical debt rather than silently masked.

#### Password/text-injection: `tapOn` immediately after `inputText` can corrupt a _different_ field

Typing into the password field, then `tapOn` on **any other** element, could inject one extra,
non-deterministic character into whichever field still held keyboard focus (observed corrupting
`Maestro1234` to `Maestro1234y`, then `Maestro1234yy` across repeated attempts) — reproduced
repeatedly, root-caused via bisection to the `tapOn` action itself (not keyboard locale, not
`secureTextEntry`, not typing speed, not the simulator's own autocorrect). Fixed by adding
`keyboardType="ascii-capable"`, `autoCorrect={false}`, `autoCapitalize="none"` to the password field
(`app/(auth)/sign-in.tsx`), retyping in a loop until the exact string is confirmed visible, and
submitting via the field's own Return key (`onSubmitEditing` + `pressKey: Enter`) instead of
`tapOn` on the Sign in button. For fields without Enter-to-submit wiring (the shared task title),
the working mitigation is: type, tap a neutral non-interactive label first (e.g. "Priority") to
give the phantom keystroke somewhere harmless to land, wait, then tap the real submit button.

#### Merged accessibility text: compound `Pressable`s need testIDs, most single-`Text` elements don't

A `Pressable` wrapping multiple `Text` children (a task row with a title + metadata, a labeled
checkbox) gets its children's text merged by iOS into one VoiceOver-style `accessibilityText`,
leaving the individual `text`/`title`/`value` fields Maestro's plain-text selectors check **empty**
— confirmed via `maestro hierarchy`. Fixed by adding dedicated testIDs (`task-row-<id>`,
`task-actions-<id>`, `completion-checkbox-<id>`, `quick-add-input-<screen>`,
`family-task-row-<id>`, `family-task-take-<id>`/`accept`/`decline`/`assign`/`reassign`,
`assignee-option-<memberId>`, `task-editor-title`, `task-editor-submit`) to every such element.
Plain single-`Text` labels (tab names, dialog buttons, section headers) were **not** affected and
plain text matching for those stayed reliable throughout.

#### Leftmost/rightmost tab bar items can't be reliably tapped — semantic selector confirmed, tap still doesn't land

**Correction to an earlier finding in this same section**: `tabBarTestID` does not propagate to the
native accessibility tree, but that is because it is simply the wrong prop name for this Expo
Router/React Navigation version, not because Expo Router's `Tabs` doesn't support a real testID at
all. The correct option is **`tabBarButtonTestID`** — confirmed by reading
`node_modules/expo-router/build/react-navigation/bottom-tabs/views/BottomTabBar.js`, which passes
`testID: options.tabBarButtonTestID` (not `options.tabBarTestID`) into `BottomTabItem`, which spreads
it onto the underlying `PlatformPressable`. Set via `options={{ tabBarButtonTestID: 'tab-today' }}`
etc. on each `Tabs.Screen` in `app/(app)/_layout.tsx`, then **verified via `maestro hierarchy`** that
every tab, including the two boundary ones, now genuinely carries `resource-id: "tab-<name>"` on the
native element (not just `accessibilityText`).

That fix is real and worth keeping — every middle tab (`Calendar`, `Inbox`, `Family`) now matches
reliably by a stable id instead of text prone to the accessibility-merging issue above, confirmed
with 3/3 clean isolated taps and again across two full clean runs of every flow. **It does not,
however, fix the leftmost (`Today`) and rightmost (`Profile`) tabs.** With the real testID in place,
`tapOn: { id: "tab-profile" }` was run 3 times in isolation, each time reported `COMPLETED` by
Maestro's own log — and each time the screenshot taken immediately after still showed the _previous_
tab selected, proving the touch itself never reached the app, not that the selector failed to
resolve. This rules out every selector-based theory (text matching, `accessibilityText` merging,
missing `resource-id`) at the root: the element is found correctly by every selector type tried; the
tap dispatched at its resolved coordinates simply does not register. The one property the two failing
tabs share, and no middle tab does: their bounds sit flush against the screen's own edge (`Today`:
`x∈[0,80]` on a 402pt-wide screen; `Profile`: `x∈[321,402]`) on this **iPhone 17 Pro, iOS 26.5
Simulator** — a real Maestro/XCUITest coordinate-resolution or touch-delivery limitation for elements
at the extreme edge, outside this app's code and not fixable from it.

**Fix, retained**: a coordinate tap (`tapOn: { point: "10%, 93%" }` / `"90%, 93%"`, percentage-based
— not absolute pixels, so it isn't tied to one physical resolution — derived from the tab bar's own
reported bounds) for those two tabs only; every other tab bar interaction uses the real
`tab-<name>` testID. Centralized to exactly these two spots across the three flows (search
`.maestro/*.yaml` for `point:`), each with its own comment pointing back to this entry. Confirmed
with two consecutive fully clean, unattended runs of all three flows after this change.

A related, broader finding while doing this verification: the same "Maestro reports `COMPLETED` but
the tap silently didn't land" signature was also observed **twice, non-deterministically, on a
genuinely middle tab** (`tab-inbox` in `personal_task_smoke.yaml` — 2 failures out of roughly 10 total
attempts across this investigation, always recoverable on the very next retry with no code change).
This generalizes the "known technical debt: genuine Maestro/XCUITest hangs" entry below: the same
underlying rare tap-delivery failure mode apparently doesn't always manifest as a hang with dead log
output — it can also manifest as a silent no-op that still reports success. It happens to be close to
deterministic at the two screen-edge positions and rare everywhere else, which is what makes the
edge tabs practically un-automatable without the coordinate fallback while the rest of the app isn't.

#### The `checked` selector attribute is unreliable for custom checkboxes — match text instead

`CompletionCheckbox` sets `accessibilityState={{ checked: completed, disabled }}` on a `Pressable`
correctly (confirmed: the icon, label, and `value`/`text` fields all reflect the real state). But
Maestro's structured `checked: true/false` selector attribute reports the string `"false"`
**regardless of actual state** for this element — confirmed via `maestro hierarchy` immediately
after a real, visually-correct completion. React Native's `accessibilityState.checked` apparently
doesn't surface as XCUITest's own native "checked" trait for a custom `Pressable` (as opposed to a
true native control). The real state **is** reliably exposed as plain text/value
(`"checkbox, checked"` / `"checkbox, unchecked"`) — both flows that toggle completion now match on
that text instead of the `checked` attribute.

#### Real app bug found and fixed: a stale-closure race in `TaskEditorForm`'s unsaved-changes guard

`TaskEditorForm`'s `beforeRemove` navigation guard checked react-hook-form's own
`isSubmitSuccessful`, gated correctly by an effect dependency array (`[navigation, isDirty,
isSubmitSuccessful, t]`) — so in isolation this looked like solid, race-free code. In practice, a
Maestro-driven submit occasionally showed a "Discard changes?" dialog immediately after an
otherwise-successful save. Root cause (confirmed via code review, then twice reproduced with real
database evidence — two task rows with timestamps ~2.5s apart from what was meant to be a single
create): `onSubmit`'s `onDone()` call navigates away **synchronously**, in the same tick the
mutation resolves — before react-hook-form's own `isSubmitSuccessful` state update has propagated
through a re-render and this effect has re-run to pick it up. The `beforeRemove` listener that
actually fires is still closed over the **pre-submit** `isSubmitSuccessful === false`, so it shows
the dialog even though the save had already gone through. **Fixed** in
`src/components/tasks/TaskEditorForm.tsx` by tracking success via a `useRef` set synchronously the
instant the mutation resolves (`justSubmittedRef.current = true`, checked directly in the guard, no
re-render required) instead of relying on `isSubmitSuccessful`. This is a real UX bug independent of
Maestro — any sufficiently fast real user could in principle have hit the same spurious dialog after
a legitimate save.

The fix required a narrowly-scoped `// eslint-disable-next-line react-hooks/refs` immediately above
`handleSubmit(...)`: `eslint-plugin-react-hooks` v7's experimental "refs" rule (React Compiler-era)
flags _any_ ref access reachable from a closure passed into a third-party wrapper like
react-hook-form's `handleSubmit`, even though that callback only ever executes as the form's submit
event handler, never during render — confirmed as a static-analysis false positive by testing every
alternative (wrapping in `useCallback`, indirecting through a second helper function) against the
same rule, all still flagged, since the rule's taint tracking is transitive through any call chain
it can't prove happens post-render.

#### Maestro flow-logic bug found and fixed: a blind recovery retry could double-submit a task

The flow's own recovery logic for the (now root-caused, still occasionally spurious pre-fix)
"Discard changes?" dialog — cancel the dialog, then retry the submit tap — was unconditional
(guarded only by Maestro's `optional: true`, which suppresses a _failure_ if the element is
missing, but still executes the step regardless of whether recovery was actually needed). When the
first submit tap had, in fact, already succeeded, the unconditional retry submitted the same
still-filled form a **second** time, creating a genuine duplicate task (reproduced once, confirmed
via direct database query: two identical rows). Fixed in both `family_task_workflow.yaml` and
`assignment_decline.yaml` by checking for success first (`family-task-row-.*` visible, `optional:
true`, 5s) and wrapping the discard/retry recovery in `runFlow: { when: { notVisible: {...} } }` so
it only ever runs when the first submit genuinely did not go through. Combined with the
`TaskEditorForm` fix above, the dialog itself no longer appears on the success path at all, so this
is now a defense-in-depth guard rather than an active workaround.

#### Maestro flow-logic bug found and fixed: a blind double-tap trigger could self-assign

The established "menu sometimes doesn't open on the first tap under fast programmatic taps"
workaround elsewhere in these flows is an unconditional double-tap on the trigger. Applied naively
to `AssigneePicker`'s "Assign" button, this was **not safe**: unlike the icon-only task-action menu
(whose popup opens away from the trigger), `AssigneePicker`'s menu opens directly over its `Button`
trigger, and the family's members array lists the caller (the family owner, User A) first. When the
first tap _did_ open the menu, the blind second tap landed on whatever was now rendered at that same
screen position — User A's own first menu item — silently self-assigning the task instead of
assigning it to User B (reproduced once, confirmed via screenshot: "Assigned to you" instead of the
intended assignee). Fixed in `assignment_decline.yaml` by checking whether the target option is
already visible first, and only retrying the trigger tap via `runFlow: { when: { notVisible: {...}
} } }` if it genuinely isn't up yet — the same conditional-retry pattern as the discard-dialog fix
above, generalized to any "menu might already be open" situation.

#### Assignee picker: both members' display names default to the same placeholder text

`AssigneePicker`'s `Menu.Item` carries both a stable testID (`assignee-option-<memberId>`) and the
member's `displayName` as its title — normally enough to pick a specific person by either. But a
freshly-seeded Maestro fixture never sets `profiles.display_name`, so `create_family_with_owner`
and `accept_family_invitation` both fall back to their hardcoded defaults (`'Owner'` /
`'Family member'` respectively) — meaning a flow with exactly the two Maestro fixtures can't
disambiguate "User B" from "User A" by visible text at all, only by member id. This is why
`e2e-seed.sh` captures and exports both members' ids (see above) rather than relying on display
names, and it's worth remembering for any future flow that needs to target a _specific_ member in a
multi-member family.

#### Known technical debt: genuine Maestro/XCUITest hangs and silent no-op taps — significant, not rare

Independent of every issue above, individual Maestro commands (`pressKey: Enter` once, a
menu-item `tapOn` once, a `tab-inbox` `tapOn` twice — see "Leftmost/rightmost tab bar items" above
for the last one — on separate runs) were observed to either hang indefinitely with no further log
output at all, or report `COMPLETED` while the tap silently failed to register — a real tool-level
failure mode on this exact iOS 26.5 Simulator + Maestro 2.10.0 combination, not localized to one
command and not something a client-side retry can wait out or detect from Maestro's own reported
status (a hang is not a failure state Maestro can detect and retry from; a false-`COMPLETED` silent
no-op is worse — the flow has to notice the _effect_ didn't happen, via a subsequent assertion, not
the command's own result). Practical rate observed during initial investigation: near-100% at the two
screen-edge tab positions (which is why they get the coordinate-tap fix above), roughly 2 failures in
~10 attempts elsewhere. **This is treated as significant, ongoing flakiness, not a rare curiosity** —
see "Retry hardening" below for the mitigation and the honest numbers from the final verification
pass, which found 0 silent no-ops across 9 full flow completions but 1 genuine hang (a full-flow
restart was needed; a hang cannot be retried around within a flow, since Maestro itself never returns
control). A bounded/unbounded retry-loop wrapper around sign-in was attempted and itself got stuck in
a real infinite-loop-like scenario; abandoned in favor of the simpler, previously-proven
single-attempt sequence for the sign-in step itself.

Investigated whether Maestro or the Simulator can stabilize this. **Maestro has no built-in option**
for disabling animations or reducing motion — confirmed by searching every string in its bundled
CLI/client/iOS-driver jars (`~/.maestro/lib/*.jar`) for `reducemotion`/`animationdrag`/
`disableanimation`: zero matches. The iOS Simulator itself does support Reduce Motion
(`xcrun simctl spawn <udid> defaults write com.apple.Accessibility ReduceMotionEnabled -bool YES`,
confirmed to write and read back successfully) and `scripts/e2e-ios.sh` now sets it, best-effort,
before every run. This is a genuine stabilization attempt, not a proven fix: the root cause here was
independently isolated to touch/tap **delivery**, not an animation timing race (the boundary-tab
investigation above found the exact same failure with `waitForAnimationToEnd` already in place), so
Reduce Motion was not expected to eliminate it and the verification numbers below should be read with
that caveat rather than credited to this setting.

#### Retry hardening: bounded, state-verified, never blind about mutations

Every coordinate-based tap (the two screen-edge tab bar items) and every tap on an element already
shown to occasionally silent-no-op (ordinary tab bar navigation, Take, Decline, the assignee-option
selection, completion toggles) now follows the same pattern in all three flows:

1. Tap once.
2. Check the expected resulting state with a short (5s) `optional` wait.
3. Only if that check fails, verify — via `runFlow: { when: ... } }` — that the **original** state is
   still present (proof the action genuinely did not happen, not just that the assertion hasn't
   caught up yet), and only then retry the same tap once, with a full timeout on the final assertion.

Navigation taps (tab bar) retry unconditionally on "destination not reached," since re-tapping a tab
is always safe. **Mutating actions never do** — task creation, the assignee-option selection, Take,
Decline, and both completion-toggle directions each gate their retry on direct proof the mutation did
not go through (e.g., Take only retries while the Take button — meaning `unassigned` — is still
present; a completion toggle only retries while the checkbox still reports the pre-tap text). This
was already true for task creation and the assignee-picker trigger (see the two flow-logic bugs
above); this pass extended the identical discipline to every other mutating tap so that no action in
these flows can ever be blindly repeated. Nothing is retried more than once, and no failure is
suppressed globally — a retry's own final assertion has a normal, non-optional timeout and fails the
flow like any other if the retry doesn't land either.

**Final verification (per-flow, isolated invocations)**: 3 consecutive full runs of all three flows,
each run as its own `maestro test <single-file>` invocation, from a fresh `db reset` + `e2e:seed`
each time (9 flow completions total). Every completion passed; every conditional retry block
evaluated `SKIPPED` (0 retries actually triggered — every tap landed on its first attempt in this
batch). One genuine hang occurred (`assignment_decline.yaml`, iteration 1, stuck mid-way through the
second sign-in's password-retype loop) and required a full flow restart, which then completed
cleanly.

**A real bug the hardening pass initially missed, found by running the literal required command**:
`npm run e2e:ios` (which runs all three flows in a single combined `maestro test .maestro/`
invocation, not three separate ones) failed on `personal_task_smoke.yaml` at
`Assert that id: task-move-to-today-.* is visible` — the task-actions menu's double-tap-to-open step
had a hard, non-optional assertion with no recovery, unlike every mutation after it. Fixed by
applying the same "check with a short optional wait, retry unconditionally (opening a menu twice is
never harmful) if the destination didn't appear" pattern to the menu-open step itself, not just the
mutation that follows it.

**Re-verifying that fix via the combined invocation surfaced a further, separate finding**: two
consecutive attempts at the literal `npm run e2e:ios` command after the fix both hung (15+ minutes
of near-zero CPU growth on the underlying `xcodebuild`/`maestro` processes, each killed manually —
neither is a false positive, since the working baseline completes all three flows in ~5–6 minutes).
This is a small sample (2 hangs in 2 combined-invocation attempts vs. 1 hang in 10 single-flow
attempts across this phase), not proof that combined invocation is categorically less reliable, but
it is a real, honestly-reported data point pointing that direction, and is recorded as such rather
than smoothed over. Simulator throughout: iPhone 17 Pro, iOS 26.5.

Taken together: the retry hardening is real defense-in-depth and did catch and let us fix one
genuine gap, but Maestro on this Simulator/OS combination remains **not deterministic** — a hang can
still strand a run (single-flow or combined) and no amount of in-flow retry logic can recover from
it, since Maestro itself stops returning control. Treat "green" as "passed this run," not as a
guarantee, and prefer single-flow invocations (`npm run e2e:ios .maestro/<file>.yaml`) over the
combined directory form if a hang-free run is needed on a deadline, since the observed hang rate was
lower there in this phase's data.

#### Expo SDK patch-version drift: `expo`/`expo-router`/`expo-notifications` — resolved, not pinned

`npx expo-doctor` flagged three packages a patch version behind what Expo SDK 57's own compatibility
metadata expected (`expo` 57.0.19→57.0.20, `expo-router` 57.0.18→57.0.19, `expo-notifications`
57.0.16→57.0.17). Confirmed this was **not** introduced by Phase 5 or this branch — `git log`
traces all three `~57.0.x` ranges back to this repository's very first commit — and was purely a
case of `node_modules`/`package-lock.json` being frozen at whatever patch versions existed on npm at
initial install time, while npm has since published newer patches that already satisfy the
**same, already-declared** `~57.0.x` ranges (confirmed via `npm view <pkg> versions`: 57.0.20/
57.0.19/57.0.17 all exist and match exactly what `expo-doctor`/`npx expo install --check` expected).
This is categorically different from the deliberate TypeScript/ESLint pins elsewhere in this file —
those exist because of real peer-dependency conflicts with this project's other tooling; this was
ordinary lockfile staleness with no conflict of any kind. Resolved via `npx expo install --fix`
(Expo's own recommended fixer, which also nudges the declared ranges up to `~57.0.20`/`~57.0.19`/
`~57.0.17` to match), followed by a full native rebuild (`rm -rf ios/Pods ios/Podfile.lock &&
npx pod-install && npx expo run:ios` — required because `expo-router` and `expo-notifications` ship
native code; the JS-only `expo export` alone would not have exercised the updated native modules).
`expo-doctor` now reports 21/21. Full re-verification after the bump: Prettier, `tsc`, ESLint, all
172 Jest tests, `wiki:lint`, a fresh `supabase db reset` + all 263 pgTAP assertions, and both
`expo export` platforms — all green, no regressions from the bump.

## Phase 6 (Reliable Family Assignment Push Notifications)

### Durable transactional outbox, not a direct send from the mutation RPC

Every assignment mutation RPC (`assign_family_task`, `accept_task_assignment`, etc.) already
inserted a `task_assignments` row before this phase; the alternative considered was calling
Expo's push API directly from inside that same RPC. Rejected: a Postgres function calling an
external HTTP API is itself a reliability and latency risk to the mutation the user is
actually waiting on, and a failed/slow push call would either roll back a perfectly valid
assignment or leave the RPC hanging on a third party it doesn't control. Instead: a second
`AFTER INSERT` trigger on `task_assignments` (`notifications.enqueue_task_assignment_notification`,
alongside the pre-existing `apply_task_assignment_action` — deliberately a second trigger, not
folded into the first, so "apply the assignment" and "decide who to notify" stay independently
reviewable and testable) writes a `notifications.outbox` row in the same transaction as the
mutation. A separate, asynchronous dispatcher (the Edge Function) claims and sends outbox rows
later — the mutation itself never blocks on, or depends on the success of, delivery.

### The `notifications` schema is excluded from PostgREST routing, not just RLS-protected

Every other table in this codebase relies on RLS + explicit grants (see
SECURITY_AND_PRIVACY.md, Mechanisms 1–2). `notifications.outbox`/`deliveries` additionally
exclude the whole `notifications` schema from `supabase/config.toml`'s `[api] schemas` list —
a routing-level restriction PostgREST enforces before grants/RLS are even consulted, so it
holds even for `service_role`. Chosen over "RLS + grants only" because these two tables hold
operational detail (retry counts, error codes, claim state) with no legitimate client read
case at all, ever — a schema-level exclusion is a stronger, simpler guarantee than "every
future policy on this table must also remember to deny everyone," and it means a mistake in a
future migration's grants on this schema still can't leak anything, since PostgREST would
never route to it regardless. Confirmed both ways: `supabase/tests/110_notification_outbox_test.sql`
(database-level: SELECT and every function, `authenticated`/`anon`) and
`scripts/e2e-notifications.sh` (API-level: a `service_role`-authenticated REST call to
`$API_URL/rest/v1/outbox` returns 404, since PostgREST never registered the route at all).

### `FOR UPDATE SKIP LOCKED` claiming + an idempotency key derived from the triggering row

`notifications.claim_pending_outbox(worker_id, limit)` uses `FOR UPDATE SKIP LOCKED` so
multiple concurrent dispatcher invocations (a webhook firing while a cron sweep is also
running, or two overlapping cron ticks) can never claim and double-send the same row — a
locked row is simply skipped by the other claimant, not waited on. Separately,
`idempotency_key` is a unique column derived deterministically from the triggering
`task_assignments.id` (`task_assignment:<id>`) with `insert ... on conflict do nothing` — this
means even a full RPC replay (a client retrying a mutation after a dropped response, landing
the same `task_assignments` insert twice at the SQL level — which the RPC's own logic already
prevents, but this is a second, independent guard) can never produce two outbox rows for the
same event.

### `PushTransport` as an injectable interface, not a mocked `fetch`

The dispatcher (`supabase/functions/dispatch-notifications/index.ts`) takes a `PushTransport`
(`sendBatch`/`getReceipts`) as a parameter rather than calling Expo's HTTP API directly and
leaving tests to mock global `fetch`. This keeps the dispatcher's own business logic (claiming,
batching, status transitions, backoff, token deactivation) testable against a real local
Postgres instance with a transport that is *fully* fake — no network stack involved at all,
not even a mocked one — while the real `createExpoTransport()` implementation (also in
`_shared/expoTransport.ts`) is the only code that ever performs a real `fetch` to Expo. The
same interface is reused by `scripts/e2e-notifications.sh`'s `cli.ts` helper for real-backend
integration testing, and would be reused again for a future direct-APNs/FCM transport if that
were ever built (see ROADMAP.md — deliberately not built this phase).

### Deno Edge Functions need their own tooling boundary, not shared tsconfig/ESLint/Jest config

`supabase/functions/` is a Deno module tree (its own `deno.json`/`deno.lock`, `npm:`/`https://`
import specifiers, a global `Deno`, `import.meta.main`) inside a repository whose root
tooling — `tsconfig.json`, `eslint.config.js`, `jest.config.js` — is configured for the Node/
Metro-bundled app. Running any of those three tools against the Deno tree fails on syntax and
globals they don't recognize; the correct fix is exclusion, not trying to make one config
satisfy both runtimes (`tsconfig.json`'s `exclude`, `eslint.config.js`'s `globalIgnores`,
`jest.config.js`'s `testPathIgnorePatterns`, all pointing at `supabase/functions`). The Deno
tree gets its own test runner (`deno test`) and its own lint/type checking via Deno's built-in
tooling, run separately — see TEST_STRATEGY.md, "Edge Functions."

### The anon-EXECUTE gap (Phase 3's finding) recurred on two new functions — confirms the checklist item is load-bearing

SECURITY_AND_PRIVACY.md's Phase 3 entry already documents that Supabase's role bootstrap
grants `anon`/`authenticated` EXECUTE on every new `SECURITY DEFINER` function directly (not
via `PUBLIC`), so `revoke ... from public` alone never actually revokes it. This phase's own
migration initially missed the same class of gap on two *new* functions
(`enqueue_task_assignment_notification`, the trigger function, and `backoff_interval`, an
internal helper) — caught only by directly querying `pg_proc`/`has_function_privilege` against
a real local instance (`docker exec -i supabase_db_familyflow psql`), not by code review of the
migration file, which looked correct at a glance. This is exactly the failure mode Phase 3's
"before adding any new `SECURITY DEFINER` function, confirm its ACL with a query" instruction
exists to prevent, and this phase is evidence that instruction needs to keep being followed
literally, not treated as a one-time Phase 3 cleanup. Fixed with the same explicit
`revoke all ... from public, anon, authenticated` pattern on both functions, re-verified with
the same query.

### Contextual permission request, never on launch

`app/notification-settings.tsx` is the only place `requestNotificationPermission()` is called,
and only from an explicit user tap — never from `app/_layout.tsx` or any screen's mount effect.
This is a product/privacy choice, not just an iOS App Store guideline nicety: a permission
prompt with no context ("why is this app asking me for this, right now, before I've done
anything?") both converts poorly and trains users to reflexively deny prompts, which is worse
for the feature than asking once, later, when the user has just enabled something that
benefits from it.

### Real infrastructure was pushed further than `scripts/e2e-backend.sh`'s original shape needed

`scripts/e2e-notifications.sh` extends that established pattern (localhost-only gate, unique
per-run identities, `set -euo pipefail`, `trap`-based cleanup, repeatable twice with no
residue) to also run the *real* dispatcher code (`dispatchNotifications()`, imported from
`index.ts` — not a reimplementation) against a real local Postgres instance, via a small Deno
CLI wrapper (`cli.ts`) that supplies only the transport as fake. Two bash portability issues
surfaced and were fixed rather than worked around: `curl` needs `--globoff` for any URL
containing an Expo push token string (`ExponentPushToken[...]` — the brackets are otherwise
parsed as a curl range expression), and bash 3.2 (macOS's default `/bin/bash`, still bash
3.2.57 in 2026) treats `"${array[@]}"` on a *genuinely empty* array as an unbound-variable
error under `set -u`, unlike bash 4+ — worked around with the `${array[@]+"${array[@]}"}`
idiom rather than disabling `set -u`.

### Not deployed this phase: the Database Webhook / `pg_cron` invocation, and any EAS/APNs/FCM configuration

Per this repository's standing rule against creating or modifying external resources without
explicit authorization, none of the following were performed, and each is a manual step for
whoever operates the actual Supabase project when this phase is ready to go live:

1. **Wire up invocation.** In the Supabase Dashboard (or via `supabase` CLI config once
   hosted): add a Database Webhook on `notifications.outbox` `INSERT` calling the deployed
   `dispatch-notifications` function (low-latency path), **and** a `pg_cron` schedule (e.g.
   every minute) calling the same function as a durable fallback for anything the webhook
   missed. Both call the same `dispatchNotifications()` handler — no code change needed,
   only the two triggers themselves.
2. **Set `NOTIFICATION_WORKER_SECRET`** as an Edge Function secret and configure the
   webhook/cron caller to send it as the `x-notification-worker-secret` header — the function
   already rejects any request missing/mismatching it (see `index.ts`).
3. **Deploy the function**: `supabase functions deploy dispatch-notifications` against the
   real hosted project (not attempted this phase — no hosted project is connected to this
   repository at all yet, per every prior phase's own standing constraint).
4. **An EAS project** (`eas init`/`eas build:configure`) is required before
   `registerForPushNotifications()` can succeed on a real device — `getExpoProjectId()`
   already returns `null` and the service throws a typed `missing_project_id` error until
   this exists, which is the correct, tested behavior for "not linked yet," not a bug.
5. **No real push has been sent or received this phase.** Every test — pgTAP, the Deno Edge
   Function suite, Jest, and `scripts/e2e-notifications.sh` — uses a fake `PushTransport`.
   Confirming an actual device receives an actual notification requires steps 3–4 above plus
   a physical device (Expo push tokens are simulator-inert — see
   `notificationService.ts`'s own `Device.isDevice` check) and is out of scope for this phase's
   local-infrastructure-only verification loop.

## Phase 6.1 (Deployment & Real Device Push Validation)

### Scope split, decided with the user before writing any code

This phase's own brief spans two fundamentally different kinds of work: (a) things
verifiable entirely from this repository against real local infrastructure — a security
regression guard, a secret/bundle audit, documentation — and (b) things that require
creating external accounts/resources (an EAS project, a hosted Supabase project, push
credentials) and a physical device, none of which an agent can do autonomously under this
repository's own standing rule against creating/modifying external resources without
explicit authorization, and the last of which (a physical device receiving and being tapped)
is not something an agent can do *at all*, authorization or not. Investigated the repo first
(no `eas.json`, no `eas` CLI installed, no `extra.eas.projectId` in `app.config.ts`, no
linked Supabase project) rather than assuming either way, confirmed the repo is genuinely
greenfield for deployment, then asked the user directly how to proceed rather than either
silently skipping most of the brief or burning significant effort on tooling for
infrastructure that might not even get created. The user chose: local-only work now, a
precise runbook for everything else. This decision, and the reasoning above, is recorded
here rather than left implicit, since it determines why roughly half this phase's own brief
(Sections 1, 2 (execution), 3 (execution), 4–8, most of the Definition of Done) is
documented-as-manual-steps rather than executed.

### Security regression guard: an invariant check, not a grant snapshot

The anon-EXECUTE-grant class of finding recurred three times before this phase (Phase 3, 5,
6) with no automated test ever existing for the *general* case — each time it was only ever
caught by a one-off manual `pg_proc`/`has_function_privilege` query, never by CI. Considered
a literal snapshot of every function's grants (compare against a recorded expected list).
Rejected per the brief's own explicit instruction — a snapshot needs editing every time a
legitimate new function is added, which trains whoever's adding it to "just update the
snapshot" rather than actually verifying the new function is safe. Built instead as a
schema-driven query (`pg_proc`/`pg_namespace`, never a hardcoded function list) asserting the
actual invariant: anon/PUBLIC may `EXECUTE` a function in `public`/`notifications` only if
it's a trigger function (Postgres itself refuses to invoke a `returns trigger` function
outside trigger context, regardless of grant — verified directly in the test, not just
asserted) or is in a short, reviewed whitelist (currently one entry:
`current_profile_id()`, a harmless `auth.uid()` wrapper). Verified the guard actually catches
a regression, not just documents one — temporarily re-granted `anon` `EXECUTE` on a real
function, confirmed the test failed with the expected assertion, reverted, confirmed it
passed again.

### `docs/DEPLOYMENT.md`: a new file, not folded into `DECISIONS.md`

The brief asks for a "deployment/runbook" as one of its documentation deliverables — this
repository had no existing home for operational (as opposed to architectural/historical)
content, so a new `docs/DEPLOYMENT.md` was added rather than growing `DECISIONS.md` (a
decision log, not a runbook) or `ARCHITECTURE.md` (design, not operations) further. Contains
exact commands for every external step (EAS init, `supabase link`/`db push`/`secrets set`/
`functions deploy`, the webhook + `pg_cron` configuration, the manual device test matrix) so
whoever has the actual accounts/device can execute it directly, plus the retry/idempotency
semantics and tickets-vs-receipts explanation the brief asks documented explicitly (an
at-least-once, not exactly-once, guarantee — matching what Expo's own infrastructure
provides, deliberately not oversold as more than that).

### What was actually verified this phase, locally

`npm run verify`, a fresh `db reset` + `test db` (299/299 pgTAP — 293 existing + 6 new),
`deno test` (11/11, unaffected), `scripts/e2e-backend.sh` (32/32) and
`scripts/e2e-notifications.sh` (24/24), `expo-doctor` (21/21), both `expo export` platforms,
and a fresh secret scan of both compiled bundles plus the public Expo config specifically for
`NOTIFICATION_WORKER_SECRET` (the brief's own named secret for this phase, not previously
scanned for by name) — clean throughout, confirming it is referenced only via `Deno.env.get`
inside the Edge Function, never client-side.

## Phase 7 (Family Calendar, Child Events, and Responsibilities)

### Evolved the existing Phase 2 schema rather than replacing it

Before writing any new RPC, audited `events`/`event_participants`/`responsibilities`
(Phase 2) and confirmed the brief's own instruction — "do not create parallel replacement
tables before proving the existing model cannot safely support the requirements" — did not
apply: the three-table event/responsibility split, the composite-FK same-family checks, and
`responsibilities.status`'s vocabulary (`unassigned | pending_acceptance | accepted |
declined | done`, already matching `tasks.assignment_status`) were all sound and reused
as-is. Only additions: `events.deleted_at` (soft cancel), a `responsibility_assignments`
audit table, and the RPC-only conversion below. No renaming for its own sake — the brief's
own prose used a shorter word ("pending") for the pending state, but the existing
`pending_acceptance` vocabulary was kept for consistency with `tasks.assignment_status`
rather than treated as a rename instruction.

### Audit finding: `events`/`event_participants`/`responsibilities` had the same direct-grant gap Phase 4 found for `tasks`

Found before any new RPC was written, same discipline as every prior phase's audit-then-fix
workflow: these three tables (Phase 2) granted raw `INSERT`/`UPDATE`/`DELETE` to
`authenticated`. `responsibilities_owner_manages` in particular let the event owner `UPDATE`
a responsibility's `status`/`assignee_member_id` directly via a plain PATCH — bypassing the
accept/decline/take state machine and its audit trail entirely, the exact shape of gap
Phase 4 found and closed for `tasks`' own direct-`UPDATE` policy. Closed identically: the
three grants revoked, the now-dead policies dropped, every mutation replaced by a narrowly
scoped `SECURITY DEFINER` RPC. `SELECT` stays direct/RLS-governed throughout, matching the
established convention.

### `responsibility_assignments`: a second audit table, not a shared one

Considered reusing `task_assignments` for responsibility history too (same shape: append-only,
`assigned_to_member_id`/`assigned_by_member_id`/`action`). Rejected — the brief itself flagged
this as a live question ("do not reuse task_assignments if that would mix task and event
semantics"), and mixing them would make "every assignment this family member has ever had"
ambiguous between two unrelated domain concepts (a task vs. an event responsibility) sharing
one table, complicating every future query that needs to distinguish them. Built
`responsibility_assignments` as a structural mirror instead — same trigger shape
(`set_responsibility_assignment_family_id`, `apply_responsibility_assignment_action`), same
self-assign-is-immediate-acceptance shortcut in `set_responsibility_assignment`, same
`FOR UPDATE`-row-locking concurrency discipline in `take_event_responsibility`. Unlike
`task_assignments`, `responsibility_id` cascades on delete — see the next entry for why that's
safe here specifically.

### `remove_event_responsibility`: hard delete, not a status, and why that's safe

The brief lists "remove an optional responsibility" as a distinct operation from unassign —
read as "the drop-off/pick-up requirement is no longer needed at all," not "no assignee."
Implemented as an owner-only hard `DELETE` of the `responsibilities` row, permitted only when
`status` is `unassigned` or `declined` (an active pending/accepted commitment can't be
silently erased out from under its assignee — unassign first, the same "can't skip a state"
shape `reassign_family_task` already uses for a completed task). `responsibility_assignments`
rows cascade-delete with it — acceptable here (unlike `task_assignments`, which must survive a
member's removal indefinitely) because once the responsibility itself is gone, there is
nothing left for that history to be *about*; the requirement's prior existence isn't a fact
the product needs to remember once the requirement is deliberately withdrawn.

### `has_member_schedule_conflict`: one function, three sources, a boolean only

Considered exposing conflict data as a view (row-per-conflict) instead of a boolean function.
Rejected: a view would need to either leak *something* identifying the conflicting item (an id
a client could then query further, defeating the privacy goal) or be so sanitized it couldn't
even distinguish "conflict" from "no conflict" reliably from the client side without an
additional round-trip. A single `SECURITY DEFINER` function checking all three conflict
sources (the member's own events, a timed task assignment, another accepted responsibility)
in one `EXISTS`/`UNION ALL` query and returning a bare `boolean` gives the client exactly the
one bit it's allowed to have, with no shape to accidentally over-expose. Half-open interval
semantics (`[starts_at, ends_at)`) throughout, matching the brief's own explicit requirement
that a boundary touch (one item ending exactly when another begins) is not a conflict —
verified both directions in `120_family_calendar_test.sql`.

### Family Today is the Calendar screen, not a second screen

The brief describes "Family Today" (a combined per-member daily schedule with warnings) and
a "Calendar Day view" (date navigation, Personal/Family mode, member filters) with
overlapping worked examples — both are, in the end, "a day's events and responsibilities,
optionally filtered by member." Built as one screen (`app/(app)/calendar.tsx`) with a
Personal/Family mode toggle; Family mode defaulted to today *is* Family Today, not a
near-duplicate view maintained in parallel. Revisit this if a later phase's UX research shows
they actually need to diverge (e.g., Family Today needing a fundamentally different layout),
but nothing in this phase's brief demanded that split.

### The MVP Day Calendar has no all-day/date-only event concept this phase

`events.starts_at`/`ends_at` are `timestamptz`, both required — every event has a real start
and end instant. The brief's Section 4 explicitly permits deferring all-day events "rather
than implementing a partial ambiguous model," which this phase does: no all-day toggle, no
date-only event path, in either the schema or `eventEditorSchema`. Revisit as its own design
pass (a `starts_date`/`ends_date` pair, or a `is_all_day` flag with UTC-midnight-anchored
instants) rather than bolting a partial version onto the current form.

### A real, previously-undiscovered bug found while building `scripts/e2e-calendar.sh`: the backend-integration scripts' user cleanup never actually ran

`admin_create_user` appended to `CREATED_USER_IDS` *inside* the function, but every call site
across `scripts/e2e-backend.sh`, `scripts/e2e-notifications.sh`, and (initially)
`scripts/e2e-calendar.sh` itself invoked it via command substitution
(`OWNER_ID=$(admin_create_user ...)`), which runs the function body in a **subshell** — an
array mutation there is discarded the instant the subshell exits, never reaching the parent
shell's `CREATED_USER_IDS`, and therefore never reaching `cleanup()`'s own iteration over it.
`scripts/e2e-backend.sh` turned out to be unaffected (it calls `admin_create_user` without
capturing output at all, so the subshell issue never arises there — it resolves user ids a
different way later). `scripts/e2e-notifications.sh` **was** affected — every run since
Phase 6 silently leaked its three `auth.users` test accounts (confirmed: 12 accumulated
`e2e-*` accounts found in the local database while investigating this). The earlier Phase 6
"no residue" verification was correct about what it actually checked (family/outbox rows,
which use a separate `FAMILY_ID` variable outside this array) but incomplete — it never
checked whether the *users themselves* were cleaned up. Fixed in both scripts by appending at
each call site instead of inside the function; manually purged the 12 leaked accounts; both
scripts re-verified to leave zero matching `auth.users` rows after two consecutive runs.
Recorded here rather than silently fixed, since it revises a specific claim
["`scripts/e2e-notifications.sh`... zero residue"] made in Phase 6's own final report.

## Phase 7 follow-up: audit against a more detailed brief, four real gaps closed

A later, much more detailed Phase 7 brief arrived after the branch above was already built and
rebased onto `develop` (which by then included Phase 6.1). Rather than re-implementing from
scratch, the brief's own working instruction was followed: audit the existing implementation
first, and only change what a concrete gap actually requires. Four real, if mostly small, gaps
were found and closed — none of them a design flaw, all of them things the original Phase 7
pass's own scope or established RNTL limitations had left short.

### Trigger functions: explicit revokes added for consistency, not because they were exploitable

`assert_responsibility_event_is_family_visible()`, `set_responsibility_assignment_family_id()`,
and `apply_responsibility_assignment_action()` — three of the four new trigger functions in
`supabase/migrations/20260907120000_family_calendar.sql` — had no explicit
`revoke ... from public, anon, authenticated`, unlike the file's own fourth trigger function
(`notifications.enqueue_event_responsibility_notification`, which does) and unlike Phase 6's own
established precedent for exactly this situation
(`enqueue_task_assignment_notification`, `supabase/migrations/20260906120000_notification_outbox.sql`,
whose own comment states the revoke is added "unconditionally... every SECURITY DEFINER function
gets an explicit revoke... unless explicitly revoked" even though a `returns trigger` function is
already uninvokable directly regardless of grant). **Not a live vulnerability**: the Phase 6.1
`130_security_regression_test.sql` guard already exempts every trigger function from its
anon-EXECUTE check for exactly this Postgres-level reason, and it passed both before and after
this fix. Added anyway, for the same defense-in-depth reasoning Phase 6 gave — a future reader
should not have to reason about `pg_get_function_result` to know a function is safe from this
file alone.

### Notification-outbox test coverage: `declined` and `taken` were never directly asserted

The brief lists all four `event_responsibility.*` event types as required test coverage.
`120_family_calendar_test.sql` only ever asserted `requested` and `accepted` directly (declined/
taken existed in the migration's trigger logic and were exercised indirectly by the state-machine
tests, but no assertion checked the resulting outbox row). Closed with four new pgTAP assertions
(plan bumped 88 → 92) proving both the event type and the correct recipient
(`recipient_member_id`) for a decline and a take, reusing `piano_pickup_id`'s existing
decline-then-take history from the state-machine section rather than new fixtures.
`scripts/e2e-calendar.sh` had the same gap for `taken` specifically (it called
`take_event_responsibility` but never asserted the resulting outbox row) — closed the same way,
with one change to the flow itself: the original script had the *event owner* take back a
responsibility they themselves had created the event for, which is exactly the self-actor/
self-recipient case Mechanism 4's self-notification suppression exists to catch — so no `taken`
row would ever have been enqueued to assert on. Changed the taker to the spouse (a family member
distinct from the event's creator) so the notification is expected to fire, and left a comment
explaining why, rather than silently picking a different actor with no explanation.

### The Day Calendar was missing the two other screens' own offline/refresh conventions

`app/(app)/calendar.tsx` had neither `<OfflineBanner />` (present on `today.tsx`) nor pull-to-
refresh (present on `FamilyTaskBoard.tsx`, the closest existing precedent for a family-wide list
screen) nor a retry action wired to its `<ErrorState />`. All three were the brief's own
explicit ask for the Day Calendar (Section 12) and already-established conventions elsewhere in
this codebase, not new design — added by mirroring `FamilyTaskBoard.tsx`'s
`RefreshControl`/`onRetry` pattern exactly, refetching whichever query pair is active for the
current mode.

### Mandatory Jest UI coverage, previously deferred, now built — and a real Metro/Expo Router gotcha found while building it

The original Phase 7 pass explicitly deferred Jest coverage for `EventEditorForm`,
`ResponsibilityRow`, and `app/(app)/calendar.tsx`, citing the phase's already-large scope and the
Phase 5-documented `react-native-paper` `<Menu>` limitation. This brief's own Section 16/18
explicitly overrides that: "deterministic Jest UI tests are mandatory and may not be deferred."
Built all three — `ResponsibilityRow.test.tsx` and a scoped `EventEditorForm.test.tsx` (trigger
buttons, disabled state, validation, and submission payloads are tested; content inside an opened
`<Menu>` still is not, per the same unchanged RNTL constraint) fully cover their brief-mandated
cases.

**A genuinely new environment gotcha, not previously documented**: the Calendar Day view's own
test was first written as `app/(app)/calendar.test.tsx`, co-located with the screen the same way
every other test in this codebase sits next to its source file. It passed under Jest — but broke
`npx expo export --platform ios` outright, because Expo Router's Metro bundler treats every file
under `app/` as a route candidate by filename-independent convention, and tried to bundle
`@testing-library/react-native` straight into the production app, failing on an unresolvable
`console` import inside the testing library itself. This is the real reason no other screen in
this codebase has ever had a co-located test file — not an oversight this phase corrected, but a
hard constraint now confirmed and documented. Fixed by moving the test to
`src/components/calendar/CalendarScreen.test.tsx`, importing the screen via a relative path
(Jest doesn't go through Metro, so this is invisible to the production bundle) — see
`docs/TEST_STRATEGY.md` for the convention this establishes for any future screen-level test.

### Verified, not just asserted

Fresh `supabase db reset && supabase test db`: `Files=13, Tests=391`, all passing. `npm run
verify` (lint, typecheck, 264/264 Jest across 37 suites, wiki:lint). `deno test`: 11/11.
`e2e:backend` 32/32, `e2e:notifications` 24/24, `e2e:calendar` run **twice consecutively without
a DB reset in between**: 28/28 both times, zero `e2e-*` residue in `auth.users` confirmed by
direct query afterward. Both `expo export` platforms succeed (the `app/` test-file bug above was
caught by this exact check, not assumed away). `expo-doctor` 21/21. A secret scan of the compiled
iOS bundle for `SERVICE_ROLE_KEY`/`NOTIFICATION_WORKER_SECRET`/`CLIENT_SECRET` found nothing.

## Phase 8 (Recurring Tasks, Scheduled Reminders, and Snooze)

### Recurrence architecture, decided before any RPC was written

**Audit first**: `recurrence_rules` (Phase 2) exists but has zero grants/policies and is
referenced by nothing writable — `docs/ROADMAP.md` already anticipated exactly this gap and
already named the anticipated shape (`task_occurrences`, "one row per generated occurrence, its
own `completed_at`, a FK back to the series' `tasks` row"). `recurrence_rules` itself only
supports `daily|weekly|monthly` (no `yearly`), has no occurrence-count end condition (only
`until`), and has no way to mark a series stopped. None of this is a design flaw — Phase 2
deliberately left it unfinished pending this exact phase.

**Chosen approach: bounded materialized occurrences, server-authoritative, generated
on-demand into a rolling horizon** — one real row per occurrence in a new `task_occurrences`
table, generated (idempotently) by a `SECURITY DEFINER` RPC the client calls whenever it needs
occurrences through a given date (Today/Tomorrow/Calendar reads, and reminder reconciliation),
never by an unbounded background job or an unbounded `INSERT ... generate_series`.

**Rejected alternative: fully virtual occurrences, computed on read from the recurrence rule
plus a sparse exceptions table.** This avoids ever materializing a row for an occurrence nobody
has touched, but was rejected for three concrete reasons: (1) Today/Tomorrow/Calendar need to
join occurrence state (completed/skipped/rescheduled) against a date range efficiently and
indexably — recomputing an RRULE-style expansion per query and left-joining a sparse exception
table for every read is real complexity for no benefit at this app's actual occurrence volumes
(a personal task list, not a calendar service processing millions of series); (2) the brief's
own conflict-detection integration (`has_member_schedule_conflict`, Phase 7) needs a real,
queryable row to check a timed task occurrence against — a virtual occurrence would need its own
parallel expansion logic duplicated into that function; (3) idempotent concurrent generation is
materially simpler to reason about and test as "insert with a unique constraint, ON CONFLICT DO
NOTHING" than as "compute the same virtual set twice and reconcile."

**`task_occurrences`**: `id`, `task_id` (FK to the series' own `tasks` row — never a duplicate
`tasks` row per occurrence), `original_date` (the date this occurrence *would* fall on per the
recurrence rule — immutable, and the true idempotency key alongside `task_id`, so a reschedule
can never reopen a duplicate-generation window at its natural slot), `occurrence_date`/
`start_time`/`duration_minutes`/`timezone` (the *current* scheduled values — mutable via
reschedule, defaulting to what the rule computed at generation time), `status`
(`scheduled | completed | skipped`), `completed_at`, `rescheduled` (boolean, true once
`occurrence_date`/`start_time` diverge from what generation produced — the client-facing
"this occurrence was moved" indicator), `created_at`/`updated_at`. `unique (task_id,
original_date)` is the concurrency/idempotency anchor: two concurrent "generate occurrences
through date X" calls (or a client retry) can never produce two rows for the same natural slot,
with or without an intervening reschedule.

**`recurrence_rules` evolved, not replaced**: `frequency` CHECK extended to add `'yearly'`; a
new nullable `count` column (`until`/`count` mutually exclusive via CHECK — `null`/`null` means
"never ends"); a new nullable `stopped_at timestamptz` (set by `stop_recurring_series`, after
which generation refuses any occurrence with `original_date` past the stop point). Existing
`by_weekday`/`interval`/`timezone` are reused as-is — Weekly's "on selected weekdays" and the
DST-safe local-wall-time anchor were already correctly designed in Phase 2, just unused until
now.

**Rolling horizon: 45 days**, chosen as comfortably longer than this app's own longest-lived
local-reminder lead time (`1 day before`, the longest documented preset) plus slack for a user
who doesn't open the app daily, while staying small enough that `generate_task_occurrences`
never risks materializing more than a few dozen rows per call even for a daily series. Extended
lazily — called from `useOwnDayEvents`/Today/Tomorrow reads (via the occurrence read model
below) and from reminder reconciliation, never from a `pg_cron` job (no server-side scheduled
generation this phase — see the "device-local scheduler" section below for why reminders
themselves also stay entirely client-triggered).

**"Edit this occurrence" is scoped to reschedule + complete/restore/skip — never content.**
Personal-task recurrence has no per-occurrence assignee (shared/recurring-task combination is
an explicit non-goal — see below), so the only thing that could plausibly differ occurrence-to-
occurrence is *when* it happens, not *what* it is. `task_occurrences` therefore carries no
title/description/priority/category override columns at all — every content field lives
exclusively on the series' own `tasks` row, and every edit to it is necessarily a series-wide
edit. This is why the required series-action dialog only ever needs to distinguish "reschedule
this one occurrence" from "change the series" — there is no third, partially-implemented
"override this occurrence's content" option to accidentally expose.

**Read model**: Today/Tomorrow/Calendar must show occurrences, not the series template (the
brief's own explicit requirement). A new `personal_task_occurrences` read path (implemented as
a `SECURITY DEFINER` RPC returning a unioned result, not a bare view — a bare view can't call
the generation RPC as a read-time side effect) supplies: one-off tasks (`recurrence_rule_id is
null`) exactly as before, straight from `tasks.date`, and recurring tasks
(`recurrence_rule_id is not null`) from `task_occurrences`, generating through the requested
date first. One-off task behavior is unchanged byte-for-byte — this phase adds a path
alongside it, never rewrites it.

**Shared/family recurring tasks are explicitly out of scope** (brief non-goal, "shared-task
recurrence assignment rules"). `task_occurrences`/`recurrence_rules` only ever get exercised
through personal-task RPCs this phase; `create_shared_family_task` gains no recurrence
parameter. Documented here so the schema's generality (nothing about `task_occurrences` is
inherently personal-only) is never mistaken for an implemented feature.

### A device-local scheduler, deliberately separate from Phase 6's server push outbox

Phase 6 built a server-authoritative push *outbox* (`notification_outbox` → Edge Function →
Expo push token) for events that originate on the server (another family member's action).
Reminders are the opposite shape: the *content* and *timing* are entirely known on-device in
advance (a task's own start time minus an offset), so there is nothing for a server round-trip
to add except latency and a network dependency a reminder shouldn't have. Reminders are
therefore scheduled entirely client-side via `expo-notifications`' local scheduling API, behind
a small `LocalScheduler` interface (`schedule`/`cancel`/`listScheduled`,
`src/lib/reminders/localNotificationScheduler.ts`) with one real implementation
(`expoLocalScheduler`) and one fake used only in tests. This is a second, independent
notification pathway from Phase 6's outbox — deliberately, not an oversight — and the two must
never both react to the same notification tap (see the router-disambiguation entry below).

**Reminder identity**: `` `${profileId}:${taskId}:${occurrenceId ?? 'series'}:${reminderId}` ``
(`buildReminderKey`, `src/lib/reminders/reminderReconciliation.ts`) — embedded directly in the
notification's own `data.reminderKey` at schedule time, never derived from the opaque native
notification id `expo-notifications` assigns, which is platform-specific and not guaranteed
stable across app restarts. The fire date is embedded the same way
(`data.reminderFireAtMs`) rather than re-derived from the native trigger object on read-back
(`listScheduled()`), whose shape differs between iOS and Android and isn't worth parsing when
the value is already known at schedule time.

**Reconciliation is deterministic and called at fixed lifecycle points — never continuous.**
`reconcileReminders()` diffs "what should be scheduled" (derived from reminder definitions plus
the occurrence read model) against "what is scheduled" (`scheduler.listScheduled()`), and
schedules/cancels only the difference. It runs from `useReminderReconciliation()`
(`app/_layout.tsx`, on auth-ready and app-foreground) and after any mutation that could change
what's due (create/update/delete a reminder, complete/restore/reschedule/skip an occurrence,
stop a series) — never from a background timer or interval. It is scoped to exactly one
profile's own key prefix, so it can never inspect or cancel another account's previously-
scheduled notifications on a shared device. This is also, deliberately, the exact function
Jest's fake-scheduler suite (15 tests, `reminderReconciliation.test.ts`) exercises against —
never a separate reimplementation of the reconciliation logic.

**Permission requested only on "add the first reminder," never at app startup** (Section 9).
`ReminderEditorSection.addPreset` checks `getNotificationPermissionStatus()` first and only
calls `requestNotificationPermission()` when the status is `'undetermined'` — an already-
granted or already-denied status is left alone (re-prompting after a denial just re-surfaces the
same OS-throttled system alert, or on iOS, nothing at all after the first prompt). This is a
real gap found and fixed mid-phase: the original `addPreset` created the reminder row directly
with no permission check at all, meaning a reminder could be silently created and then never
fire because nothing had ever prompted for OS permission.

**"Show task titles in notifications" defaults to disabled** (Section 10,
`notification_preferences.reminder_titles_enabled boolean not null default false`, a small
follow-up migration rather than a rewrite of the Phase 6 notification-preferences migration).
When off, a reminder notification's title/body are a fixed generic string ("FamilyFlow" /
"Task reminder") regardless of the task's actual content — decided at *build* time in
`buildContent()`, not filtered at *display* time, so the task's title is never even passed to
`expo-notifications` when the preference is off. This is the same privacy-is-a-data-layer-
guarantee discipline the rest of the app follows, applied to notification payloads.

**Two independent notification-response systems must never both react to one tap.**
Phase 6's `useNotificationResponseRouter` (`src/lib/notifications/notificationResponseRouter.ts`)
already handles server-push payloads shaped `{ taskId | eventId, ... }`. The new
`useReminderNotificationActions` handles local reminder payloads shaped
`{ notificationType: 'task_reminder', ... }`. `resolveNotificationRoute` now explicitly
excludes any payload where `'notificationType' in payload` — a real cross-router collision that
would otherwise have double-handled (or mis-handled) every local reminder tap, found while
wiring the second router in.

**Snooze/Done act on the actual delivered notification, not a freshly re-derived one.** The
notification category (`task_reminder.v1`) registers a fixed action set (Done, +15/+30/+60 min,
Tonight, Tomorrow, Custom) per Section 11; Done marks the occurrence complete and Snooze
re-schedules a fresh one-shot local notification at a fixed offset from *now* (or, for
Tonight/Tomorrow, a fixed documented local time) — it never touches the underlying reminder
definition or series, only that one delivered instance.

### Native verification: what was actually driven on-device, and a genuine tooling limitation found

Section 19 requires a real native rebuild and on-device verification of local scheduling, not a
simulated description. `npx expo run:ios` succeeded (0 errors) against a real iPhone 17 Pro
(iOS 26.5) simulator. What was directly, visually confirmed on that running app: real sign-in
via Supabase Auth end-to-end; a task created through the exact RPC path the app itself uses
(`create_personal_task`, with `start_time`) correctly appearing in the real Today screen's
Timed section at the correct time — direct proof the occurrence-aware read model
(`personal_task_occurrences`) works outside of mocked tests; a reminder created via
`create_task_reminder` correctly appearing in the real Edit Task screen's Reminders section,
confirming `useTaskReminders` works live; deep-linking (`familyflow://…`) correctly routing to
both the Notifications settings screen and a specific task's edit screen; the existing
"Enable push notifications" button correctly refusing to proceed on a simulator (`Device.isDevice`
gate, Phase 6), with the expected on-screen message — confirming that gate still behaves
correctly and is a genuinely different code path from local-reminder permission.

**The `<Menu>` blocker (confirmed, not assumed) and how it was worked around.**
`ReminderEditorSection`'s and the task editor's Category picker's shared `react-native-paper`
`<Menu>` never visibly opens when driven by Maestro on this exact setup:

- Six distinct tap strategies against the reminder Menu's anchor (`testID`, text-with-retry,
  exact point coordinates, after dismissing an unrelated overlay, after a full app relaunch,
  after a scroll) all reported `COMPLETED` in Maestro's own output, but the following screenshot
  showed no state change every time.
- A live `maestro hierarchy` dump taken immediately after a tap showed **zero** menu content
  anywhere in the accessibility tree — not merely invisible, genuinely never mounted.
- A screen recording of the tap, extracted frame-by-frame (`ffmpeg`, installed this session for
  this purpose), showed the button's own pressed-state highlight correctly appearing — proving
  the touch *is* registered by the `Pressable` — with no menu content in any frame before or
  after.
- The same failure reproduces on a second, independent `<Menu>` on the same screen (the
  Category picker), ruling out a `ReminderEditorSection`-specific bug: both anchor `Button`s live
  on a screen presented via expo-router's `presentation: 'modal'` (native-stack modal
  presentation), which is the one property they share.

This is consistent with — and, via the live reproduction, now doubly confirms — the `<Menu>`
unreliability already documented from Jest/react-test-renderer since Phase 5
(`docs/TEST_STRATEGY.md`), extending the known limitation from "unreliable under
react-test-renderer" to "unreliable under Maestro-driven live interaction when the anchor lives
on a natively-presented modal screen." It reads as a genuine interaction between
`react-native-paper`'s `Portal`-based rendering and `react-native-screens`' native modal
presentation, not an application defect — the anchor `Button`'s own `onPress` and pressed state
work correctly; only the portaled menu content fails to mount.

Rather than block the rest of Section 19's requirements on a UI-automation limitation, a small
`__DEV__`-gated diagnostic screen (`app/dev-diagnostics.tsx`, registered in `app/_layout.tsx`
only when `__DEV__` — absent from any production build) was added **temporarily** to call the
*production* functions directly: `requestNotificationPermission()`/
`getNotificationPermissionStatus()` (the exact functions `ReminderEditorSection.addPreset`
calls — not reimplemented), `reconcileReminders()` (the exact production reconciliation
algorithm, fed real data from `listAllPendingReminders`/`listAllScheduledOccurrences`, the same
service functions the real app hooks call), and `expoLocalScheduler.listScheduled()` (the real
scheduler's own read-back). The screen displayed only ids/keys/fire-times — never a reminder's
task title — reachable only via a direct deep link (`familyflow://dev-diagnostics`), with no
entry point reachable through normal in-app navigation. This was explicitly a **diagnostic**,
not a reimplementation or a production shortcut: every button on it called the same production
code path a real user action would, just without requiring the broken `<Menu>` tap first.

**The diagnostic screen and its route registration have since been removed** (a
production-surface cleanup pass, same session) — `app/dev-diagnostics.tsx` no longer exists,
`app/_layout.tsx`'s conditional `Stack.Screen` for it is gone, and both `expo export` outputs
and `npx expo config` were re-checked to confirm zero trace of it in a production build (route
manifest, bundled JS, and public config). The findings below remain true and are preserved as
the evidence obtained while it existed — the functions it called (`requestNotificationPermission`,
`reconcileReminders`, `expoLocalScheduler`, `useReminderNotificationActions`) are ordinary
production code, untouched by the diagnostic's removal.

**What this newly, genuinely verified on-device while the diagnostic screen existed** (real
device, real OS, real `expo-notifications` calls throughout):

1. **Permission**: tapping "Request notification permission" triggered the real iOS system
   dialog ("FamilyFlow Would Like to Send You Notifications"); tapping "Allow" (a real Maestro
   tap on a genuine system alert — XCUITest's one specially-supported cross-process interaction,
   unlike the Menu/lock-screen cases below) flipped `getNotificationPermissionStatus()` from
   `undetermined` to `granted`, confirmed by reading the status back before and after.
2. **Local scheduling requires no push token, no EAS project, no `Device.isDevice` gate** —
   directly confirmed: the existing "Enable push notifications" button (Phase 6,
   `registerForPushNotifications()`) correctly threw `unsupported` on this same simulator in the
   same session, while `requestNotificationPermission()` and the reconciliation-driven schedule
   below succeeded on the identical device with no code path in common.
3. **The production `reconcileReminders()` scheduled a real native request** with the exact
   expected deterministic key and fire time: for a task with `start_time` 23:02 local
   (Europe/Kyiv) and an offset-0 reminder, `expoLocalScheduler.listScheduled()` returned exactly
   one request with key `<profileId>:<taskId>:series:<reminderId>` and
   `fireDate: 2026-09-08T20:02:00.000Z` (23:02 local) — computed independently by the real
   reconciliation code from real database rows, matching by construction, not by assertion.
4. **The notification was actually observed delivered** — a lock-screen screenshot, taken after
   the fire time, shows a real system notification: `FamilyFlow — Task reminder — 1m ago`. The
   generic body ("Task reminder," not the real task title "Native verification reminder 2")
   directly confirms the `reminder_titles_enabled` default-off privacy behavior is correctly
   enforced in a real delivered notification, not just in a Jest assertion. A second,
   independent scheduling round for a different reminder showed the identical result, and in
   both cases the request disappeared from `listScheduled()` immediately after its fire time —
   the real OS clearing a fired one-shot trigger, additional independent confirmation of genuine
   delivery.
5. **Reschedule correctly cancels and re-schedules the same logical reminder.** Updating a
   task's `start_time` via `schedule_personal_task` (the real RPC the app's own reschedule flow
   calls) and re-running reconciliation produced `cancelled=1 scheduled=1`: the stale native
   request was cancelled, a new one was scheduled under the **same** key with the **new** fire
   time — proving the update path is wired correctly end-to-end, on a real device, not just in
   the fake-scheduler suite.
6. **Delete correctly cancels.** Calling `delete_task_reminder` (the real RPC) and re-running
   reconciliation reduced `listScheduled()` to zero native requests for that key.
7. **Past reminders are correctly, permanently skipped, never re-scheduled** — reconciling with
   two already-fired reminder definitions still in the input set produced
   `skipped: [...] (past)` for both, `scheduled` only for the one genuinely-future reminder —
   the exact deterministic, idempotent behavior the architecture promises, observed against real
   data on a real device, not asserted against fake data in Jest.

**What remains unverified, and is not reported as observed: tap-to-navigate, and the Snooze/Done
notification actions.** These require interacting with UI that iOS renders in a separate
process (SpringBoard — the lock screen, a notification banner, Notification Center), not the
target app's own view hierarchy. Distinctly from the `<Menu>` finding above (an in-app,
same-process rendering failure), this is a structural limitation of Maestro's iOS automation:
a flow scoped to `appId: com.familyflow.app` can drive genuine cross-process system UI in
exactly one specially-supported case — the OS permission alert, which worked (see point 1
above) — but plain taps against lock-screen/Notification-Center content, tried multiple ways
(exact-text selector, point-coordinate tap, a swipe to open Notification Center from both the
lock screen and the Home Screen), never registered as a real interaction with that content: text
selectors reported "element not found" against system-rendered notification text, and
point-coordinate taps completed with no observable effect. This is consistent with Maestro/
XCUITest's iOS automation being scoped to the target app's own process for ordinary interaction,
with the permission-alert case being a deliberate, narrow exception Apple/XCUITest supports —
not a defect in this app's own notification-action wiring, which is covered instead by the real
production code exercised at the reconciliation layer above, by
`useReminderNotificationActions.test.tsx`'s fake-response-driven suite (Done/Snooze/tap
handling against the real handler function), and by the DB-level idempotency assertions in
`140_recurring_tasks_reminders_test.sql`.

**Android**: `npx expo export --platform android` succeeds and `expo-doctor` passes with the
Phase 8 changes in place; no Android exact-alarm permission was requested or added (Section 24
stop-condition, correctly never triggered — `expo-notifications`' default trigger types need no
`SCHEDULE_EXACT_ALARM`). A real Android native build/run was not attempted this session — no
emulator/device verification beyond the export/doctor checks above.

### Final validation pass: occurrence-vs-series UX audit, and a real Tonight/Tomorrow ordering bug

A follow-up validation pass audited the "This occurrence / Entire series" UX Section 7 requires
and found the current implementation already correct in substance, but with one piece of dead,
misleading scaffolding: `tasks:recurrence.seriesActionThisOccurrence`/`seriesActionEntireSeries`
i18n keys existed in both locale files with zero references anywhere in the codebase — no
component ever rendered them. There is, and was, no interactive "pick a scope" dialog at all:
complete/restore/reschedule/skip always target the occurrence directly (`task.occurrenceId`),
and editing content always routes to the series' own row (`task.seriesTaskId ?? task.id`,
`today.tsx`/`tomorrow.tsx`) with the existing `seriesNotice` HelperText making that explicit —
there is no ambiguity for a dialog to resolve, by construction, since each action already
implies its own scope. The two dead keys were removed (both locale files) rather than left as
scaffolding that could mislead a future reader into thinking such a dialog exists or should be
built with per-occurrence content semantics. `TaskEditorForm.test.tsx` (new — the component had
no test file at all before this) locks in: the series notice renders and "This occurrence"/
"Entire series" never render anywhere in the editor; the Repeat picker never appears in edit
mode; the Stop-repeating confirm dialog has exactly two actions (Cancel, Stop repeating — never
a third "this occurrence" option) and calls `stop_recurring_series`, never
`update_recurring_series`. Confirms, incidentally, that `react-native-paper`'s `<Dialog>` (used
for this confirm) mounts and interacts correctly under Jest — the documented `<Menu>`
limitation above is specific to `<Menu>`'s own Portal-rendering path, not `Portal`-based
components in general.

**A real bug found via the dev-diagnostics native verification above, not by inspection**:
`useReminderNotificationActions.ts`'s `SNOOZE_TONIGHT` handler rolled a fixed 20:00 anchor
forward by exactly 24h once it had passed for the day — meaning tapped after 20:00 local,
"Tonight" resolved to *tomorrow* 20:00, which is *later* than "Tomorrow" (a fixed tomorrow
09:00 anchor), inverting the two options' relative ordering exactly when a user would actually
reach for "Tonight" (in the evening). Found because this session's own Jest run happened to
execute near midnight local time, and the existing `SNOOZE_TONIGHT`/`SNOOZE_TOMORROW` test read
real wall-clock time with no fixed system clock — a second, related gap (a genuinely
non-deterministic test that had simply never been exercised late enough in the day to fail
before). Fixed both: production code now falls back to `now + 1 hour` (always earlier than
tomorrow's fixed 09:00 anchor) instead of the same hour 24h later when tonight's anchor has
already passed; the test now fixes system time via `jest.useFakeTimers().setSystemTime(...)`
for determinism, split into a midday case (the anchor hasn't passed) and a dedicated late-night
case (the exact scenario that broke) so the fix has a permanent regression guard.

Also corrected: `docs/MVP_SCOPE.md` listed conflict *detection* under "V2 — explicitly out of
scope," despite Phase 7 having implemented `has_member_schedule_conflict()` two phases earlier
— a real, pre-existing docs/code contradiction, unrelated to Phase 8's own work but noticed
while auditing scope boundaries during this pass. Corrected to note detection is implemented,
resolution remains V2.

### Verified, not just asserted

Fresh `supabase db reset && supabase test db`: `Files=14, Tests=461`, all passing (the new
`140_recurring_tasks_reminders_test.sql` plus zero regressions in the 13 pre-existing files).
`npm run verify`: lint, typecheck, `342/342` Jest across 43 suites (up from 331/42 — the new
`TaskEditorForm.test.tsx`, the local-permission-independence tests in
`notificationService.test.ts`, and the Tonight/Tomorrow-ordering regression tests), `wiki:lint`
clean, confirmed stable across 3 consecutive full runs. `deno test`: `11/11` steps, zero
regressions. `e2e:backend` 32/32, `e2e:notifications` 24/24, `e2e:calendar` 28/28 — all still
green, confirming the Phase 8 schema/RPC additions introduced no regression in earlier phases'
backends. `e2e:recurrence` (23 checks) run **twice consecutively without a DB reset in
between**: 23/23 both times. Both `expo export` platforms succeed, including with the new
`__DEV__`-gated diagnostic screen present. `expo-doctor`: 21/21. A secret scan of both compiled
bundles for `SERVICE_ROLE_KEY`/`NOTIFICATION_WORKER_SECRET`/`CLIENT_SECRET` found nothing. Real
native build/launch/sign-in/data-flow/permission-grant/scheduling/delivery/reschedule/
cancellation all directly verified on a physical-simulator iOS 26.5 device, as detailed above;
tap-to-navigate and the Snooze/Done notification actions specifically could not be verified due
to a structural, cross-process iOS UI-automation limitation (not an app defect) also detailed
above, and are not claimed as observed.

## Phase 9 (Secure Realtime Sync, Offline Resilience, and Conflict Center) — in progress

**Status note, written mid-phase**: this entry documents what has actually been built and
verified so far (DB layer, Realtime manager, persisted cache, offline mutation queue,
sync-status UI), not the full 28-section brief. The Conflict Center UI, the real local
Realtime WebSocket integration test, the offline integration test suite, native device
verification, and the full documentation/wiki pass for the *remaining* scope are not yet
done — see `knowledge/wiki/engineering/realtime-sync-and-offline.md` for the current
done/not-done split, kept current as the phase continues.

### Broadcast, not Postgres Changes — and a content-free payload, not a sanitized one

`postgres_changes` was rejected outright (same reasoning as the Phase-2-era note in
[SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) this phase superseded): it broadcasts the
full row before RLS narrows *visibility*, not *content* — a private row's payload could still
carry its title to a connection RLS merely permits to see the event exists. Supabase's
Broadcast-from-Database (`realtime.send`, private channels, RLS on `realtime.messages`) was
chosen instead. The brief went one step further than that earlier plan (which proposed
broadcasting the `family_schedule` view's own *sanitized* shape): broadcasts here carry no row
content at all, ever — a fixed `{version, scope, entity, operation}` envelope. This is
strictly more private (nothing to redact wrong) at the cost of the client always needing a
follow-up fetch through the normal RLS-gated read path, which it already does for every other
query — no new read path was needed to make this work.

### `realtime.topic()` reads a per-subscription-attempt GUC — verified directly, not assumed

`realtime.topic()` is `nullif(current_setting('realtime.topic', true), '')::text` — it returns
whatever the real Realtime server sets via `set_config('realtime.topic', ..., true)` for that
specific subscription attempt, not a property of the row or the session in general. A plain
`psql` `SELECT` against `realtime.messages` with no topic GUC set makes every RLS policy here
evaluate to `false` — confirmed by a real query returning 0 rows where it should have matched,
before formalizing the pgTAP suite. Every RLS test in
`supabase/tests/150_realtime_offline_conflicts_test.sql` wraps its assertion in
`set_config('realtime.topic', '<topic>', true)` first, matching the real server's own
authorization flow — a test that forgot this would silently prove nothing (every policy false
either way) rather than failing loudly, which is why this is called out here explicitly.

### Idempotency: `client_operation_id` for create, `expected_updated_at` for update/schedule

`create_personal_task` gained a nullable `client_operation_id uuid` column plus a partial
unique index `(owner_profile_id, client_operation_id) where client_operation_id is not null`.
The RPC checks for an existing row with the same `(caller, client_operation_id)` first and
returns its id on replay instead of inserting — a duplicate delivery (offline queue retry,
crash-then-relaunch) can never create a duplicate task. `update_personal_task`/
`schedule_personal_task` gained a nullable `p_expected_updated_at timestamptz` precondition:
when supplied and it no longer matches the row's actual `updated_at`, the RPC raises with
errcode `40001` (`serialization_failure` — reused deliberately rather than inventing a bespoke
code, since it is a real, standard Postgres code whose meaning — "retry against a state that
moved under you" — already matches) instead of applying the write. Adding these parameters via
bare `CREATE OR REPLACE FUNCTION` would have created an *additional* overload rather than
replacing the original (Postgres function identity includes the parameter type list) — each of
the three functions is preceded by an explicit `DROP FUNCTION IF EXISTS <exact prior
signature>`, with `REVOKE`/`GRANT` reapplied after (dropping a function drops its grants too).
Both `update_personal_task`'s Phase 5 assignment-status guard and
`schedule_personal_task`'s Phase 8 recurring-task guard were preserved by rebuilding each
function body from its current (latest-migration) source rather than the original Phase 4
version — a near-miss caught by grepping for every later migration that had already touched
these same functions before writing the Phase 9 version.

### Offline queue scope: six personal-task operations, nothing else

Family/shared task mutations, assignments, invitations, family membership, events,
responsibilities, recurrence-series edits, reminder-definition edits, category creation, and
notification token changes are never queued — they fail immediately while offline with a
clear message, the same as before this phase. Only create/update/schedule/complete/restore/
delete of a personal, one-off task queue. An offline create is Inbox-only (no `date`) — a
dated offline create is refused with a clear message rather than queued, since Section 9
scoped queued creation to "an unscheduled Inbox task" specifically. Recurring-occurrence
complete/restore (also named in the brief's Section 9 list) is **not yet wired into the
queue** — deferred, tracked as a known gap, not silently dropped from scope.

### FIFO dependency chaining: an offline-created task's own id isn't known until it syncs

A task created offline is optimistically rendered under a client-generated id
(`clientGeneratedId`) before the server assigns a real one. If the user then completes/edits
that same task while still offline, the dependent operation is queued against
`clientGeneratedId` as its `entityId`, since the real id doesn't exist yet. Once the create
replays successfully, `useOfflineQueueStore.remapClientGeneratedId` rewrites every later op
still pointing at that `clientGeneratedId` to the real server id before its turn comes up —
the one real "FIFO replay where dependencies require it" case (Section 10) this phase's scope
actually produces, found and fixed before it could ship as a silent data-loss bug (completing
the *wrong*, nonexistent, task id).

### Stale-write conflicts surface today only as "Sync issue" — full resolution UI deferred

A queued update/schedule that loses its `expected_updated_at` precondition is marked `failed`
with `lastSafeErrorCode: 'conflict'` and never retried automatically — the queue guarantees it
can never silently overwrite a change made elsewhere. What is **not** yet built is Section 11's
full manual-resolution UX (a distinct "Sync conflict" message with Reload/Review/Discard/Retry
actions) — today this surfaces through the same generic sync-status "Sync issue" + Retry as any
other permanently-failed operation. Recorded here as a deliberate, temporary scope reduction,
not an oversight — see [ROADMAP.md, "Offline behavior"](ROADMAP.md).

