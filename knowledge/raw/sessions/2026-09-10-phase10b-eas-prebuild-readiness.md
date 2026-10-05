# 2026-09-10 — Phase 10B: EAS pre-build readiness pass

Continuation on `release/mvp-beta`, directly following EAS project initialization the same
day. The repo owner asked for a local-only readiness pass: confirm the `eas.json` profile-to-
environment mapping, recommend the first iOS build profile, confirm the five required
EXPO_PUBLIC_* variables and their recommended visibility, and investigate/resolve the
`expo-doctor` 20/21 finding if it was purely a compatible patch drift — with no build, no Apple
credentials, no EAS environment variable creation, and no reading of `.env.local`.

## What this session did

1. **Inspected `eas.json`** and found none of its four build profiles declared an EAS
   `"environment"`. Confirmed via the installed CLI's own help text
   (`eas env:list --help`: "Default environments are 'production', 'preview', and
   'development'") that this is a real, distinct EAS concept from build-profile names, then
   added `"environment": "development"` to `development-simulator`/`development-device`,
   `"preview"` to `preview`, `"production"` to `production`. Verified correct — not just
   syntactically valid — via `eas config -p ios -e <profile>` (a read-only display command)
   for all four profiles, each echoing back the intended environment.
2. **Recommended the first iOS build profile in two stages**, since no Apple Developer
   credential exists yet: `development-simulator` first (buildable today, no Apple account
   needed, but structurally can't validate push — `Device.isDevice` is `false` on Simulator),
   then `development-device` once `eas credentials` has been run — the profile that actually
   matters for this beta's real goals (push, cross-device Realtime, the native matrix).
   `preview`/`production` were confirmed not to be first-build candidates by design.
3. **Confirmed the five required EAS build variables** by re-grepping `src/lib/env.ts`'s
   validated schema directly (not assumed from memory): `EXPO_PUBLIC_SUPABASE_URL`,
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`,
   `EXPO_PUBLIC_AUTH_APPLE_ENABLED` — matching exactly what Phase 10B's earlier Auth audit had
   already traced. Recommended `plaintext` visibility for all five (confirmed the exact
   visibility vocabulary — `plaintext | sensitive | secret` — via `eas env:set --help`, not
   guessed), reasoning that every `EXPO_PUBLIC_*` value ships in the built client bundle
   regardless of storage-tier choice, so no real confidentiality is gained by a higher tier;
   noted `sensitive` as an acceptable, purely cosmetic alternative for the anon key
   specifically, and explicitly ruled out `secret` (write-only, unhelpful for values a
   developer may need to re-copy). No EAS environment variable was created.
4. **Investigated `expo-doctor`'s 20/21 finding** — root cause stated directly by the tool
   itself: `expo@57.0.20` (SDK expects `~57.0.21`) and `expo-router@57.0.19` (SDK expects
   `~57.0.20`), both within their own `~57.0.x` package.json ranges. Confirmed via `npx expo
   install --check` (non-mutating) that these were the only two affected packages before
   changing anything. Applied `npx expo install --fix` — Expo's own SDK-compatibility-aware
   resolver, not `npm update`/`npm audit fix` — which bumped exactly those two in
   `package.json`; `package-lock.json` also shows a transitive `expo-modules-jsi` bump to
   `57.1.0`, pulled in by `expo`'s own updated tree rather than chosen directly, confirmed
   still "SDK 57 compatible" as a set by `expo-doctor` itself reporting 21/21 afterward.
5. **Full verification re-run**: `npm run verify` (65/576, unaffected — no client/RPC code
   changed), `npx expo-doctor` (21/21, was 20/21), `npx expo config --type public` (resolves
   correctly, `projectId` intact), `npx expo export --platform ios` and `--platform android`
   (both clean), the established client-bundle/public-config secret audit re-run against both
   fresh exports (no `NOTIFICATION_WORKER_SECRET`/`SERVICE_ROLE`/`CLIENT_SECRET` match),
   `git diff --check` clean.
6. **Documentation**: `docs/RELEASE_CHECKLIST.md` (new "EAS build profile readiness" section
   with the full profile/environment table, first-build recommendation, and the five-variable
   visibility matrix; `expo-doctor` status updated to 21/21; "Next Stage B step" left pointing
   at iOS signing credentials, still the correct next item), `docs/DEPLOYMENT.md` (EAS section
   1 updated to mention the environment field), `docs/DECISIONS.md` (new "Phase 10B EAS
   pre-build readiness" section), `knowledge/wiki/engineering/push-notifications.md` (a
   further Phase 10B note).

## Deliberately not done this session

- No EAS build was started.
- No Apple credential was generated or requested.
- No EAS environment variable was created or modified (`eas env:set` was never run — only
  `--help` text and the read-only `eas config`/`eas env:list --help` were consulted).
- `.env.local` was never read, printed, or copied.
- No major or blind dependency upgrade — only the two packages `expo-doctor` itself named,
  via Expo's own resolver.

## Verification

`npm run verify` — 65 suites/576 tests, clean (unaffected by the dependency bump). `npx
expo-doctor` — 21/21 (was 20/21). `npx expo config --type public` — resolves correctly. `npx
expo export --platform ios` and `--platform android` — both clean; the established secret
audit found no matches in either export or in the public config. `git diff --check` — clean.
`eas config -p ios -e <profile>` (read-only) confirmed all four profiles resolve to their
intended EAS environment.
