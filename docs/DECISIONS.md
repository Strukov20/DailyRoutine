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
