# Architectural Decisions

Short ADR-style entries. Newest first is not enforced — entries are grouped by topic instead,
since several were made together during the foundation build.

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
