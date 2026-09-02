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
