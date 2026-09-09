# Release Checklist (MVP Beta)

Tracks Phase 10 ("MVP Stabilization, Deployment, and Beta Release," see
[DECISIONS.md, "Phase 10"](DECISIONS.md)) against its own two-stage model: **Stage A** (local
release readiness — no external accounts, credentials, or hardware needed) and **Stage B**
(operator-assisted deployment and device validation — needs the repo owner to create accounts,
approve costs, and run builds on real hardware). This document states plainly what's done,
what's pending, and why — never claims a layer was verified when it wasn't.

## Stage A — Local Release Readiness: complete

| Area | Status | Evidence |
| --- | --- | --- |
| Family ownership transfer | ✅ Done | `transfer_family_ownership` RPC, atomic write ordering, `family_ownership_transfers` audit table. `170_release_safety_test.sql`. |
| Family deletion / leaving | ✅ Done | `delete_family`/`leave_family` RPCs, soft delete, Realtime invalidation. Same test file. |
| Account deletion | ✅ Done | `request_account_deletion` RPC (anonymize, never hard-delete `auth.users`), in-app typed-confirmation dialog (`app/(app)/profile.tsx`), full client-state cleanup on the existing sign-out path. |
| Raw-client bypass prevention | ✅ Done | Column-scoped `UPDATE` grants on `families`/`profiles` exclude `deleted_at`/`owner_id`. |
| Privacy/data-lifecycle documentation | ✅ Done | [SECURITY_AND_PRIVACY.md, "Mechanism 6"](SECURITY_AND_PRIVACY.md); this document's own "Data lifecycle" table below. |
| Privacy policy draft | ✅ Drafted, not published | [PRIVACY_POLICY_DRAFT.md](PRIVACY_POLICY_DRAFT.md) — needs an operator-supplied support contact and hosting decision before it can be published anywhere. |
| Environment separation | ✅ Done | [DEPLOYMENT.md, "0. Environments (Phase 10)"](DEPLOYMENT.md); `EXPO_PUBLIC_APP_ENV` already fails closed. |
| `eas.json` build profiles | ✅ Configured, not linked | Four profiles (`development-simulator`, `development-device`, `preview`, `production`). No EAS project linked. |
| Security audit (DB + client + deps) | ✅ Done, this pass | See "Security audit results" below. |
| Automated test suite | ✅ Green | 65 Jest suites / 576 tests; 18 pgTAP files / 578 assertions; 11/11 Deno; 4 backend e2e suites (32+24+28+23); offline (5) and realtime (28) e2e suites each run twice consecutively with zero residue. |
| Native local build checks | ✅ Green | `expo config --type public`, `expo export --platform ios`, `expo export --platform android`, `expo-doctor` (20/21, pre-existing unrelated patch drift), `git diff --check`. |
| Documentation + LLM Wiki | ✅ Updated, this pass | See each doc's own Phase 10 section; wiki update recorded in `knowledge/wiki/log.md`. |

## Stage B — Operator-Assisted Deployment and Device Validation: pending

None of the following has been attempted. Each requires the repo owner's direct action — an
account, a credential, a cost approval, or physical hardware this environment does not have.
Nothing below should be read as "tested and passing on a smaller scale" — it has not been
exercised at all.

| Area | Status | What's needed |
| --- | --- | --- |
| Hosted Supabase staging project | ⏳ Not created | An Expo/Supabase account decision (see "Questions for the repo owner" below), then project creation and migration deployment per [DEPLOYMENT.md](DEPLOYMENT.md). |
| EAS project link / credentials | ⏳ Not created | Expo account + org, `eas init`, signing credential generation (Apple/Google). |
| Real device push notifications | ⏳ Not verified | A hosted Supabase project, a linked EAS project, and a physical iOS and/or Android device — see [DEPLOYMENT.md, "4–11"](DEPLOYMENT.md). |
| Native beta test matrix (iOS/Android physical) | ⏳ Not run | Physical devices; see [BETA_TESTING.md](BETA_TESTING.md) for the exact matrix. |
| TestFlight / Play Internal Testing builds | ⏳ Not built | Apple Developer / Google Play Console accounts, approved EAS Build/Submit. |
| Beta tag (`v0.1.0-beta.1` suggested) | ⏳ Not created | Explicit operator approval of the exact commit, after Stage B validation. |

**If the repo owner chooses to stop here**, this is honestly **Phase 10A complete; Phase 10B
pending** — not "Phase 10 complete" and not "the app is ready for a real beta family." A real
family beta specifically needs push notifications and cross-device Realtime sync verified on
physical hardware, which Stage A cannot provide.

## Questions for the repo owner (needed before any Stage B step)

None of these have been asked yet in this session; asking them is the next step before any
Stage B work can begin, per this phase's own "ask, don't infer approval" rule:

1. Final beta display name (distinct from the internal working name "FamilyFlow" if desired).
2. Expo account/organization to build under.
3. Expo project slug, iOS bundle identifier, Android application ID, and URL scheme — none of
   these have been reserved; the current [`app.config.ts`](../app.config.ts) values are
   placeholders and must be confirmed or changed before any identifier is locked in by a real
   build or store listing.
4. Initial version number (recommended `0.1.0`) and build number/version code starting point.
5. Whether the beta targets iOS, Android, or both from day one.
6. Whether a hosted Supabase staging project already exists or needs to be created.

## Security audit results (this pass)

**Database**
- ✅ RLS enabled and forced on every exposed table (pre-existing, re-verified).
- ✅ No unintended mutation grants — `families`/`profiles` UPDATE grants are column-scoped;
  every privileged mutation goes through a `SECURITY DEFINER` RPC.
- ✅ Every `SECURITY DEFINER` function has an explicit safe `search_path`, correct ownership,
  minimum grants, and explicit revokes — including the new internal
  `_remove_or_leave_family_member` helper (a real gap found and fixed this phase — see
  [DECISIONS.md, "Phase 10"](DECISIONS.md)).
- ✅ The schema-wide anon-EXECUTE regression guard (`130_security_regression_test.sql`) still
  passes against every function in `public`/`notifications`, including all four new RPCs.
- ✅ No existence oracle — `transfer_family_ownership` returns identical errors for a
  nonexistent, cross-family, or already-removed target member id.
- ✅ Assignment/ownership state machines cannot be bypassed by a raw client write — see
  "Raw-client bypass prevention" above.
- ✅ Account deletion cannot bypass the "never orphan a family without an owner" invariant —
  `request_account_deletion` is blocked (`22023`) while the caller owns any family.

**Client**
- ✅ No service-role, secret, worker-secret, APNs, or FCM credential present anywhere in the
  mobile client or its bundle (re-confirmed via `expo export` output inspection this pass).
- ✅ Logging (`src/lib/logger/logger.ts`) redacts to identifiers/codes only — `profileService.ts`
  and `familyService.ts`'s error mapping for the new RPCs follow the same pattern as every
  existing service.
- ✅ Account switching / sign-out clears TanStack Query cache, the persisted offline cache, the
  offline mutation queue, pending deep links, Realtime channels, notification tokens, and now
  (Phase 10) `useUIStore`'s account-scoped fields — proven by `AuthProvider.test.tsx` and
  `uiStore.test.ts`.

**Dependencies**
- No dependency changes were made this phase beyond what Phase 10's own code required (none) —
  no blind `npm audit fix`, no major upgrades. `expo-doctor`'s one failing check
  (`expo`/`expo-router` patch-version drift) is pre-existing and unrelated to this phase's
  changes; tracked as a build-tool-only finding, not a release blocker.

## Data lifecycle (account and family deletion)

See [SECURITY_AND_PRIVACY.md, "Mechanism 6"](SECURITY_AND_PRIVACY.md) for the full writeup.
Summary:

| Data | On account deletion | On family deletion |
| --- | --- | --- |
| `profiles` row | Anonymized in place (`deleted_at` set, name/avatar cleared); never hard-deleted | Unaffected |
| `auth.users` row | Untouched this phase (documented future Edge Function, not built) | Unaffected |
| Private tasks/events owned by the caller | Soft-deleted | N/A |
| Family-shared tasks/events owned by the caller | Left in place (other members may depend on them) | Left in place, but unreachable — see below |
| Other family memberships | Left (soft-removed) | N/A |
| The family itself | N/A | Soft-deleted (`deleted_at`); every member instantly loses access via the RLS choke point |
| Device tokens | Deactivated | Unaffected |
| Pending invitations sent by the caller | Revoked | Revoked (all of the family's) |
| Family ownership transfer history | N/A | Preserved (append-only, but no further access once the family is deleted) |

## See also

- [BETA_TESTING.md](BETA_TESTING.md) — the beta tester checklist, bug-report template, and the
  native device test matrix.
- [PRIVACY_POLICY_DRAFT.md](PRIVACY_POLICY_DRAFT.md) — the draft policy, not yet published.
- [INCIDENT_AND_ROLLBACK.md](INCIDENT_AND_ROLLBACK.md) — how to diagnose common failure modes
  and roll back a bad release.
- [DEPLOYMENT.md](DEPLOYMENT.md) — the exact hosted-deployment steps for Stage B.
