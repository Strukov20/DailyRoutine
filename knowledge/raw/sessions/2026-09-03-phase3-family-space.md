# Session: Phase 3 — Family Space, invitations, family members, child profiles

Date: 2026-09-03. Branch: `feature/family-space` off `develop` (which already contains all of
Phase 2, merged via GitHub PR #1 outside this session). Continues directly from the Phase 2
follow-up sessions (Docker resolution, real E2E verification, and a same-session PKCE
`flowType` fix to the Supabase client found while the user tried to sign up in the running
app — see `docs/DECISIONS.md` for that fix; it landed as commit `d123623`, the branch point
for this session).

## Brief

"Continue working on the existing FamilyFlow repository. This is Phase 3: Family Space,
invitations, family members, and child profiles." Full text covered, in order: a mandatory
security regression audit of the Phase 2 sanitized views/RLS before adding anything;
`create_family_with_owner`; multi-family support with TanStack Query as the source of truth
and Zustand limited to the active-family-ID preference; a full invitation system
(hashed tokens, sanitized preview, deep-link/Share/copy-link delivery, no email provider);
Owner/Adult/Child permission enforcement in the database; owner-orphan prevention; secure
child-profile CRUD; a full Family UI screen set with strict `screens → hooks → repositories →
Supabase client` layering; pgTAP + Jest coverage; a real multi-user local verification flow;
doc/wiki updates; a specific commit strategy; and a final report. Explicitly still out of
scope: task CRUD, calendar, Realtime, notifications, shopping lists, AI. The brief's own final
line: "Begin with the mandatory repository and Wiki inspection, then present a concise
execution plan before editing."

## Section 1 — security regression audit (performed before any new code)

Verified via direct inspection, not assumption:

- Every `SECURITY DEFINER` function across all Phase 2 migrations has an explicit
  `set search_path = public` (or `''`) — checked with a script scanning every
  `security definer` occurrence for a matching `set search_path` before its `$$;` terminator.
  Zero gaps.
- `anon` has zero grant on any base table or sanitized view (`family_schedule`,
  `family_task_board`) — reconfirmed via the full existing pgTAP suite (88 assertions,
  including `060_privacy_regression_test.sql`'s secret-marker sweep), all still passing.
- `families`/`family_members` still have no `INSERT` grant for `authenticated` — the known,
  expected gap `create_family_with_owner` closes.
- **New finding**: `family_invitations_select_family_or_invitee`'s invitee-by-email branch
  gives direct table `SELECT` (family_id, invited_by, status, etc.) to anyone whose JWT email
  matches `invited_email`. Incompatible with link/token delivery (no email provider) and an
  uncontrolled-interface exposure regardless. Replaced with owner-only direct access; all
  invitee-facing reads go through `get_family_invitation_preview(token)` instead.
- **Second, more consequential finding, made partway through implementing the new RPCs**:
  every `revoke all on function ... from public` statement in the codebase — Phase 2's
  helpers included — never actually revoked `anon`'s `EXECUTE`, because Supabase's own role
  bootstrap grants it directly (`alter default privileges in schema public grant execute on
  functions to anon, authenticated, service_role`), as an ACL entry separate from `PUBLIC`.
  Confirmed by querying `pg_proc.proacl` on the real local instance — `anon=X/postgres`
  showed up on every function, `is_family_member`/`is_family_owner`/`current_family_ids`
  included. Caught a real bug this way: the first version of the Phase 3 pgTAP suite had a
  test asserting `get_family_invitation_preview` returns `42501` for `anon`, and it failed
  ("caught: no exception") — the function actually ran, because `anon` really did have
  `EXECUTE`. Fixed by revoking from `anon` explicitly everywhere (`public, anon` instead of
  just `public`), not only `public`. Full writeup: `docs/DECISIONS.md`, "Phase 3."

## Section 2–8 — schema and RPCs

One migration, `supabase/migrations/20260903120000_family_management.sql`:
`create_family_with_owner`; the five invitation RPCs
(`create_family_invitation`/`get_family_invitation_preview`/`accept_family_invitation`/
`decline_family_invitation`/`revoke_family_invitation`) built around a new `token_hash`
column (SHA-256 of a 244-bit random token, generated from two concatenated
`gen_random_uuid()` values — no `pgcrypto` dependency needed, since `sha256()` on `bytea` is
core Postgres since v13); `create_child_profile`/`update_child_profile`; and
`remove_family_member` (owner-only, unconditionally refuses to remove the `role = 'owner'`
row). All are `SECURITY DEFINER`, `set search_path = public`, and — per the finding above —
explicitly revoke from `anon` as well as `public`.

`supabase/tests/080_family_management_test.sql` (48 assertions) covers every RPC's
success/failure paths per persona (owner, the invited user, an unrelated outsider, anon), plus
regression assertions that `families`/`family_members` still reject a direct client `INSERT`
and that `token_hash` is not selectable even by the owner (column-level grant). Writing it hit
several real pgTAP/psql mechanics worth remembering (all fixed, all now passing):

- `\gset prefix_` sets psql variables named `prefix_<column>` — referencing them later needs
  `:'prefix_column'`, not the bare column name (`inv1_token`, not just `token`).
- Comparing two `:'var'` substitutions with `isnt()`/`is()` can hit "could not determine
  polymorphic type because input has type unknown" — needs an explicit `::text`/`::uuid` cast
  on both sides.
- A fixture inserted mid-test needs `reset role;` first if the currently-simulated persona
  doesn't have the grant that fixture requires (e.g. constructing an already-expired
  invitation row directly, as `postgres`, partway through a test running as an authenticated
  persona).
- `family_invitations_expires_after_created`'s `CHECK` constraint means a fixture backdating
  `expires_at` into the past must also backdate `created_at` further, or the insert itself
  violates the constraint before the test ever gets to assert expiry behavior.

`npx supabase db reset && npx supabase test db`: **136/136 assertions pass** (88 Phase 2 +
48 Phase 3), against a real local Postgres instance.

## Section 9–11 — application layer

`src/domain/family/{types,mappers,schemas,errorMessages,hooks}.ts` +
`src/lib/family/familyService.ts` (+ `inviteLink.ts`), mirroring the `authService.ts` /
`domain/profile/*` / `domain/auth/*` pattern from Phase 2 exactly, and establishing it
explicitly as the pattern for every future feature (see `docs/ARCHITECTURE.md`, new
"Layering" section). `useActiveFamily()` is the one place `uiStore.activeFamilyId` and the
TanStack-Query-owned family list meet: it falls back to the first family when the stored
preference no longer refers to a family the user belongs to, and persists that fallback back
into the store.

UI: `app/(app)/family.tsx` rewritten (family switcher, roster, pending-invitations list for
owners, entry points); `app/family/{create,invite,add-child}.tsx` and
`app/family/member/[id].tsx` as modal/detail routes registered alongside `app/task/new.tsx` in
`app/_layout.tsx`'s signed-in `Stack.Protected` block; `app/invite/[token].tsx` as a
top-level route (outside both `Stack.Protected` groups, like `reset-password.tsx`) so it
renders for a signed-out visitor too — a new `pendingInviteToken` field on `useUIStore`
carries the token through the sign-in/sign-up flow (which has no param-passing mechanism of
its own), consumed by a redirect effect in `app/_layout.tsx`'s `RootNavigator` once `status`
becomes `'signed-in'`. `expo-clipboard` was added (`npx expo install`) for the copy-link
button; native rebuild needed before it's testable on-device (not done this session — same
situation as `expo-web-browser` in the Phase 2 follow-up).

A new i18n namespace, `family` (`src/i18n/locales/{en,uk}/family.json`), replaces the old
`screens.json`'s placeholder `family.*` block. Ukrainian strings were written avoiding
gendered verb agreement where the subject's gender is unknown (e.g. "Запрошення від {{inviter}}"
rather than a gendered past-tense verb for "invited by") — the same category of issue flagged
as a follow-up for the Profile screen's theme picker in an earlier session, applied
proactively here rather than repeating it.

## Section 12–13 — test coverage

pgTAP: covered above (136/136). Jest: `src/lib/family/familyService.test.ts` (mocks
`supabase.from`/`.rpc` chains — a custom `makeChain()` stub reproducing supabase-js's
query builders being `PromiseLike` after any chain length, since a naive
`mockResolvedValue` doesn't support `.select().eq().order()` chaining), `src/domain/family/
errorMessages.test.ts`, `src/domain/family/mappers.test.ts` (including the CHECK-constraint
fallback-narrowing behavior), and `src/domain/family/hooks.test.tsx` (`useActiveFamily`'s
selection logic via RNTL's `renderHook` + a real `QueryClientProvider`). Two real testing
lessons surfaced and are now recorded in `docs/TEST_STRATEGY.md`:

- `renderHook` in `@testing-library/react-native@14` is itself `async` — `const { result } =
renderHook(...)` (unawaited) silently yields `result: undefined`, not an error.
- `jest.mock('@/lib/family/familyService')` (bare automock) still evaluates the real module to
  infer its shape, which transitively imports the real Supabase client and its AsyncStorage
  native module — failing under Jest even though every call would have been mocked. Fixed
  with an explicit factory listing every export as `jest.fn()`.

Full suite: `npm run verify` (lint + typecheck + test + wiki:lint) — 61/61 Jest tests, 15
wiki articles validated, clean lint/typecheck.

## Section 14 — real multi-user verification

A curl-driven script against the live local stack (not `supabase test db`'s simulated
`set local role` personas) created three real `auth.users` accounts via the Auth admin API
(owner, member, outsider), signed each in for a real JWT, and drove the full flow through
PostgREST's `/rest/v1/rpc/*` and `/rest/v1/*` endpoints: `create_family_with_owner` →
`create_family_invitation` → `get_family_invitation_preview` (as the invited user, and,
separately, confirmed `401` for `anon` with no auth at all — the real-world proof the
`anon`-EXECUTE fix above actually holds, not just in the pgTAP simulation) →
`accept_family_invitation` → confirmed the outsider sees zero rows for the family via RLS →
confirmed the roster has both members → `create_child_profile` → confirmed the roster grows
to three → confirmed removing the owner is rejected (`400`) → confirmed removing the child
succeeds. **16/16 checks passed.** The local DB was reset afterward
(`supabase db reset`) to discard the ephemeral E2E accounts and re-confirm the pgTAP suite
still passes clean on the migrations alone.

## Section 15 — docs/wiki updates (this pass)

`docs/DECISIONS.md` (new "Phase 3" section — eight entries, including both audit findings),
`docs/DATA_MODEL.md` (`family_invitations` table + ownership-summary row),
`docs/SECURITY_AND_PRIVACY.md` (new Implementation-status bullet on the function-grant
finding), `docs/ARCHITECTURE.md` (new "Layering" section), `docs/ROADMAP.md` (ownership
transfer as an explicit V2 item), `docs/TEST_STRATEGY.md` (new test-layer rows + two testing
conventions). Wiki: `domain/family-spaces.md` rewritten (the "hard prerequisite for Phase 3"
gap it used to flag is now closed), `engineering/security-model.md`,
`engineering/data-model.md`, `engineering/authentication.md`,
`engineering/system-architecture.md`, `engineering/testing-strategy.md`, and
`product/glossary.md` (new "Invitation" term) updated; this file and the `log.md` entry below
are new.

## Outcome

All of Sections 1–16 of the brief completed and verified for real (pgTAP + real curl E2E), not
reasoned through. Deferred, and explicitly recorded as deferred rather than silently dropped:
family ownership transfer / "owner leaves" (`docs/ROADMAP.md`), native on-device testing of
`expo-clipboard`'s copy-link button (needs a native rebuild, same situation as
`expo-web-browser` previously), and everything the brief itself scoped out (task CRUD,
calendar, Realtime, notifications, shopping lists, AI).
