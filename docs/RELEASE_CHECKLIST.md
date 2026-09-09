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
| Automated test suite | ✅ Green | 65 Jest suites / 576 tests; 19 pgTAP files / 602 assertions; 11/11 Deno; 4 backend e2e suites (32+24+28+23); offline (5) and realtime (28) e2e suites each run twice consecutively with zero residue. |
| Native local build checks | ✅ Green | `expo config --type public`, `expo export --platform ios`, `expo export --platform android`, `expo-doctor` (21/21 — see "Dependencies" below), `git diff --check`. |
| Documentation + LLM Wiki | ✅ Updated, this pass | See each doc's own Phase 10 section; wiki update recorded in `knowledge/wiki/log.md`. |

## Stage B — Operator-Assisted Deployment and Device Validation: in progress

The hosted Supabase staging project now exists and is linked — the first real Stage B step.
Everything else below is still not attempted and still requires the repo owner's direct
action — an account, a credential, a cost approval, or physical hardware this environment does
not have. Nothing below should be read as "tested and passing on a smaller scale" unless
explicitly marked done.

| Area | Status | What's needed |
| --- | --- | --- |
| Hosted Supabase staging project | ✅ Linked, all 23 migrations deployed | Project ref `ocurkeddkqkeitjfbcbe`, region `eu-west-1`. Confirmed Local/Remote parity, including `20260912140100_fix_hosted_lint_warnings.sql` (the Phase 10B corrective pass — see [DECISIONS.md](DECISIONS.md)). |
| Hosted schema lint | ✅ Clean | `supabase db lint --linked --level warning` reports "No schema errors found," after fixing two unused-variable warnings and a real `IMMUTABLE`-declared-but-`STABLE`-routed bug in `compute_next_occurrence_date` — see [DECISIONS.md](DECISIONS.md) for the full root-cause analysis. |
| Auth Site URL / redirect URL allowlist | ⏳ Not configured | `supabase/config.toml` already declares the correct intended values (`site_url = "familyflow://"`, `additional_redirect_urls` including `familyflow://*`), but `supabase db push` never syncs `[auth]` settings — that needs a separate `supabase config push` or manual Dashboard entry, neither run this pass. See [DEPLOYMENT.md, "0a"](DEPLOYMENT.md) for the exact traced values. |
| EAS project linked | ✅ Linked | `@bombastiiic/familyflow`, project ID `de243f7f-c6ad-4537-a799-621d645baf31` — created via `eas init --account bombastiiic --non-interactive`, `extra.eas.projectId` added manually to `app.config.ts` (a dynamic config, so the CLI can't auto-write it). **No build, no credential, no submission** — see [DECISIONS.md, "Phase 10B EAS initialization"](DECISIONS.md). |
| iOS signing credentials | ⏳ Not created | Requires an active Apple Developer Program membership; `npx eas credentials`. Not attempted — explicitly out of scope for the initialization pass. Android deferred — see Platform target below. |
| Real device push notifications | ⏳ Not verified | EAS project now linked. Still needed: iOS push credentials (`eas credentials`) and a physical iOS device — see [DEPLOYMENT.md, "4–11"](DEPLOYMENT.md). |
| Native beta test matrix — **iOS physical** | ⏳ Not run | A physical iOS device; see [BETA_TESTING.md](BETA_TESTING.md) for the exact matrix. Android rows deferred by the platform-target decision below, not dropped. |
| TestFlight build | ⏳ Not built | Apple Developer account, approved EAS Build/Submit. Play Internal Testing deferred (Android not in scope for the first beta round). |
| Beta tag (`v0.1.0-beta.1` suggested) | ⏳ Not created | Explicit operator approval of the exact commit, after Stage B validation. |

**If the repo owner chooses to stop here**, this is honestly **Phase 10A complete; Phase 10B
pending** — not "Phase 10 complete" and not "the app is ready for a real beta family." A real
family beta specifically needs push notifications and cross-device Realtime sync verified on
physical hardware, which Stage A cannot provide.

## Questions for the repo owner (needed before any Stage B step)

Answered 2026-09-09:

1. Final beta display name — not asked separately; no objection raised to the internal working
   name, treat "FamilyFlow" as the beta name unless told otherwise.
2. Expo account/organization to build under — **confirmed: `bombastiiic`** (the personal
   account — the first value given, `boombastiiic`, was a typo, caught by an exact-match
   `eas whoami` check before anything was created; see
   [DECISIONS.md, "Phase 10B EAS initialization"](DECISIONS.md)). `eas init --account
   bombastiiic --non-interactive` has been run; the project is linked, see item 4 below and
   the Stage B table above.
3. Expo project slug, iOS bundle identifier, Android application ID, and URL scheme —
   **keep the current placeholders**: slug `familyflow`, bundle/application id
   `com.familyflow.app`, scheme `familyflow` (`src/config/app-info.json`). These are now
   confirmed, not placeholders pending change — do not alter them without asking again.
4. Initial version number and build number — **confirmed and now in code**: `app.config.ts`
   sets `version: '1.0.0'`, `owner: 'bombastiiic'`, and `ios.buildNumber: '1'`; `extra.eas.
   projectId` is set to `de243f7f-c6ad-4537-a799-621d645baf31` (the linked
   `@bombastiiic/familyflow` project — added manually since `app.config.ts` is a dynamic
   config the EAS CLI can't auto-write). `eas.json`'s `cli.appVersionSource: "local"` means an
   EAS build will read these values directly. See
   [DECISIONS.md, "Phase 10B EAS initialization"](DECISIONS.md).
5. Platform target — **iOS only for now**. Do not spend Stage B effort on an Android EAS
   build/credential/TestFlight-equivalent until iOS is through the matrix and the repo owner
   says to add Android.
6. Hosted Supabase staging project — **done.** Linked (ref `ocurkeddkqkeitjfbcbe`,
   `eu-west-1`); 22 migrations deployed; a 23rd (corrective, not new functionality) exists
   locally and is verified via `db push --dry-run` but **not yet pushed** — see "Next Stage B
   step," below.

## EAS build profile readiness (Phase 10B)

No build was run this pass — this is a local-only readiness check, verified via `eas config`
(a read-only display command, not a build).

**Profile → EAS environment mapping** (`eas.json`), confirmed correct via `eas config -p ios
-e <profile>` for all four, which echoes back which environment each profile resolved to:

| Profile | EAS environment | Distribution | Target |
| --- | --- | --- | --- |
| `development-simulator` | `development` | internal | iOS Simulator |
| `development-device` | `development` | internal | physical device |
| `preview` | `preview` | internal | physical device |
| `production` | `production` | store | physical device |

**Recommended first build — two stages, since Apple credentials don't exist yet:**

1. **`development-simulator` first** — the only profile buildable today with zero Apple
   Developer account dependency (Simulator builds need no distribution certificate). Useful
   purely as a build-pipeline sanity check (does the app actually compile and boot under EAS's
   build environment) — it cannot validate push notifications, since `Device.isDevice` is
   `false` on Simulator (see [DEPLOYMENT.md](DEPLOYMENT.md), "1. EAS / Expo Push
   infrastructure").
2. **`development-device` next**, once `npx eas credentials` has been run (see "Next Stage B
   step," below) and a physical iOS device is available — this is the profile that actually
   matters for this beta's validation goals (real push tokens, real Realtime sync across
   devices, the native beta matrix in [BETA_TESTING.md](BETA_TESTING.md)).

`preview`/`production` remain later-stage profiles (internal beta distribution and eventual
store submission respectively) — not the first build under any circumstance.

**EAS environment variables — five required, none created this pass** (creating them was
explicitly out of scope): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`, `EXPO_PUBLIC_AUTH_APPLE_ENABLED` —
same five traced in [DEPLOYMENT.md, "0b"](DEPLOYMENT.md). Recommended `eas env:set`
`--visibility` (confirmed exact values via `eas env:set --help`: `plaintext | sensitive |
secret`):

| Variable | Recommended visibility | Why |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `plaintext` | Fully public by design — every `EXPO_PUBLIC_*` value ships in the built client bundle regardless of how it's stored server-side (confirmed via the client-bundle `strings` audit this repo already runs). No confidentiality is gained by hiding it in the EAS dashboard. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `plaintext` (or `sensitive` as a low-cost, non-functional convention) | Supabase's own anon/publishable key is explicitly designed to be public — RLS, not key secrecy, is the real security boundary (see [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)). `sensitive` merely avoids it appearing in a dashboard screenshot or CI log verbatim; it changes nothing about the built app. Never `secret` — that tier is write-only (can't be read back), which is actively unhelpful for a value a developer may legitimately need to re-copy. |
| `EXPO_PUBLIC_APP_ENV` | `plaintext` | A label (`"staging"`), not sensitive in any sense. |
| `EXPO_PUBLIC_AUTH_GOOGLE_ENABLED` | `plaintext` | A boolean flag, currently `false`. |
| `EXPO_PUBLIC_AUTH_APPLE_ENABLED` | `plaintext` | A boolean flag, currently `false`. |

`secret` visibility should be reserved for values that are genuinely never supposed to reach
the client — this project has none of those among `EXPO_PUBLIC_*` names by construction (see
[DEPLOYMENT.md, "0. Environments"](DEPLOYMENT.md)'s rule that a secret must never carry that
prefix); `NOTIFICATION_WORKER_SECRET` and any future service-role value are set via `supabase
secrets set` against the Supabase project, not as an EAS build variable, and stay entirely out
of this matrix.

## Next Stage B step: iOS signing credentials

The corrective migration and EAS project linking are both done — see the Stage B table above.
Not yet executed: iOS push/signing credentials, which is the next concrete action, and the
biggest remaining prerequisite before any real build.

- **What**: `npx eas credentials` (interactive) against the linked `@bombastiiic/familyflow`
  project — generates or uploads an APNs key/certificate for push, and a distribution
  certificate + provisioning profile for signing.
- **Why**: no iOS build (`development-device`, `preview`, or `production` profile) can produce
  an installable artifact without these; EAS can manage them interactively rather than
  requiring manual Apple Developer portal work.
- **Requires**: an active Apple Developer Program membership (paid, $99/year as of this
  writing — confirm current pricing directly with Apple, this document is not the source of
  truth for it) under whichever Apple account will own the app's identifiers.
- **Verification**: `npx eas credentials` lists the stored credentials for the project;
  `npx eas build --profile development-device` (not run this pass) would be the first real
  consumer of them.
- **Rollback**: credentials can be revoked/regenerated from the Apple Developer portal or via
  `eas credentials` itself; nothing here is destructive to existing app data.

This step was explicitly **not** performed — generating credentials, running a build, or any
store/TestFlight action all remain gated on separate, explicit approval, per every pass so far
in this phase. After credentials, the remaining Stage B items are an actual
`development-device` build and, once a physical iOS device is available, the native beta
matrix in [BETA_TESTING.md](BETA_TESTING.md).

Once this project exists, the next steps are `supabase link`, comparing local vs. remote
migrations, and deploying — all covered in [DEPLOYMENT.md](DEPLOYMENT.md), none of it run yet.

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
- `expo-doctor`'s one failing check (20/21, `expo`/`expo-router` patch-version drift, present
  since Phase 5) is now resolved: `npx expo install --fix` bumped `expo` (`~57.0.20` →
  `~57.0.21`) and `expo-router` (`~57.0.19` → `~57.0.20`) — the exact two packages the check
  named, both within their existing `~57.0.x` SemVer range, nothing else. `expo-doctor` now
  reports 21/21. No blind `npm audit fix`, no major upgrades — see
  [DECISIONS.md, "Phase 10B EAS pre-build readiness"](DECISIONS.md) for the full before/after.

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
