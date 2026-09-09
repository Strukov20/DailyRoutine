# 2026-09-10 — Phase 10B: Auth, deep-link, and staging-environment configuration audit

Continuation on `release/mvp-beta`, after the repo owner confirmed the Staging Supabase
project is linked (ref `ocurkeddkqkeitjfbcbe`, `eu-west-1`, all 23 migrations deployed,
hosted `supabase db lint --linked` clean) and provided the confirmed EAS identity (Expo owner
`boombastiiic`, slug `familyflow`, iOS bundle id `com.familyflow.app`, version `1.0.0`, iOS
build number `1`, iOS-first). The user's instructions were explicit and narrow: audit only,
trace every URL/value to actual code or configuration (never guess), never retrieve or print
any secret, never touch the Supabase Dashboard or run any external configuration action, and
stop and report.

## What this session did

1. **Traced every Auth-facing redirect URL to its exact source**: read
   `src/lib/supabase/authRedirect.ts` (the single builder function), all three callers
   (`authService.ts`, `oauth.ts`), and all three landing routes (`app/(auth)/confirm.tsx`,
   `app/reset-password.tsx`, `app/auth-callback.tsx`) directly — confirmed
   `familyflow://confirm?code=...`, `familyflow://reset-password?code=...`,
   `familyflow://auth-callback`. Confirmed the invitation link
   (`familyflow://invite/<token>`) is a separate, purely app-internal mechanism never touched
   by Supabase Auth — it must not go in Supabase's redirect allowlist. Confirmed notification
   tap routing generates no URL at all (in-process `router.push()` only).
2. **Resolved a genuine open question — does an EAS build need a different callback? — from
   the actual installed library source**, not general knowledge: read
   `node_modules/expo-linking/src/createURL.ts` directly. Its own doc comment confirms
   development and production builds (including any EAS profile) resolve to `<scheme>://path`;
   only Expo Go resolves to `exp://host:port/--/path`. Conclusion: no separate "EAS-build
   callback" exists — `familyflow://*` covers every non-Expo-Go build.
3. **Found the single most load-bearing gap of this audit**: checked
   `npx supabase config --help` directly and confirmed `supabase config push` is a distinct
   command from `db push` — deploying migrations does not sync `config.toml`'s `[auth]`
   section to a hosted project. The Staging project therefore has zero working Auth redirects
   configured despite every migration being deployed. Did not run `config push` or touch the
   Dashboard — flagged for the operator instead.
4. **Verified the project URL pattern without fetching or printing anything secret**: read
   `supabase/.temp/linked-project.json`, `supabase/.temp/project-ref` (confirms the exact
   project ref matches what the operator stated) and `supabase/.temp/pooler-url` (confirms the
   region matches `eu-west-1`) — all pre-existing local CLI cache files from the operator's own
   prior `supabase link`, none containing a secret. Did not write the resulting literal URL
   into any committed file — directed the operator to copy it from the Dashboard's own API
   settings page instead, consistent with the explicit "do not insert it until verified"
   instruction.
5. **Resolved the anon-key-vs-publishable-key question by exhaustive grep**: confirmed
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` is validated as an opaque string (`src/lib/env.ts`) and
   passed straight through to `createClient()` (`src/lib/supabase/client.ts`) — no code
   anywhere decodes it as a JWT or assumes a shape. No code change needed regardless of which
   key format the Staging Dashboard shows.
6. **Found and corrected two stale claims in `docs/DEPLOYMENT.md`**: "only Local exists — no
   Staging... has been created or linked" and "No hosted Supabase project is connected to this
   repository" were both accurate when written and are now false. Corrected in place,
   preserving the parts that remain true (Edge Function still not deployed, secret still not
   set, no EAS project yet).
7. **Found a version/build-number contradiction, reported but not fixed**: `app.config.ts`
   hardcodes `version: '0.1.0'` and has no `ios.buildNumber` at all, but the operator has now
   confirmed `1.0.0`/build `1`; `eas.json`'s `appVersionSource: "local"` means an EAS build
   would read the stale value. Left unfixed since release-identity fields were outside this
   pass's explicit Auth/deep-link/staging-environment scope — flagged in
   `docs/RELEASE_CHECKLIST.md` instead.
8. **Produced the operator configuration matrix** (`docs/DEPLOYMENT.md`, new "0a"/"0b"
   sections): exact Site URL, exact redirect allowlist, exact staging `.env` variable names,
   and which values the operator must copy from the Dashboard versus which are already
   code-correct.

## Deliberately not done this session

- No Dashboard setting was changed.
- `supabase config push` was not run.
- No CLI command that prints project API keys was run.
- No secret, password, or token was retrieved, printed, or logged.
- `app.config.ts`'s version/build number was not edited (flagged only).
- No Edge Function deployment, webhook/cron configuration, EAS linking, or EAS build.

## Verification

Read-only pass — no migration, RPC, or client code changed. `npm run verify`/
`supabase test db` were not re-run since nothing they cover changed. Documentation-only
changes: `docs/DEPLOYMENT.md` (two stale-claim corrections, two new sections), `docs/DECISIONS.md`
(new "Phase 10B Auth audit" section), `docs/RELEASE_CHECKLIST.md` (three items updated with
confirmed values/new findings), `knowledge/wiki/engineering/authentication.md`.
