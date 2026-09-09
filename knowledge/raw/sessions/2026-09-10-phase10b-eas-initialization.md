# 2026-09-10 — Phase 10B: EAS project initialization

Continuation on `release/mvp-beta`, directly following the Auth/deep-link/staging-environment
audit earlier the same day. The repo owner authorized EAS project initialization/linking only
(explicitly not a build, not credentials, not TestFlight, not submission), with a confirmed
identity: Expo owner `boombastiiic`, slug `familyflow`, expected project
`@boombastiiic/familyflow`.

## What this session did

1. **Confirmed branch/clean tree**, inspected `app.config.ts`/`eas.json`/`package.json`,
   preserved every existing identifier (slug, scheme, bundle id, Android package, plugins).
   Added the confirmed release-identity fields to `app.config.ts`: `owner: 'boombastiiic'`,
   `version: '1.0.0'` (was `'0.1.0'`), `ios.buildNumber: '1'` (new field). Left Android
   `versionCode` untouched (none existed to preserve).
2. **Verified `.env.local` is git-ignored** (`git check-ignore -v`) without reading its
   contents, per explicit instruction.
3. **Ran `npm run verify`** as a sanity check before proceeding and found a pre-existing,
   unrelated failure: `ConflictsScreen.test.tsx`'s "Today" bucketing test used a UTC-based
   `today` fixture against a screen that buckets by local calendar date. Confirmed it predated
   this session's own changes (`git stash` + rerun), fixed it using the same production util
   the screen itself uses (`todayDateString()`), and committed it separately (`c07989b`) from
   the EAS work, since it's an independent, already-fully-verified correction.
4. **Ran `npx eas-cli@latest whoami`** — the explicit stop-gate before any EAS action. It
   returned `bombastiiic`, not the requested `boombastiiic` — confirmed at the byte level
   (`xxd` on the raw output) to rule out a terminal-rendering artifact before treating it as a
   real mismatch. **Stopped immediately, did not run `eas init`**, left the `owner` field
   in `app.config.ts` uncommitted, and reported the exact discrepancy back to the user rather
   than guessing which spelling was correct.
5. **User confirmed** `bombastiiic` (single "o") was correct — the original message had a
   typo — and to use the personal account, not the `bombastiiics-team` org, both of which
   `whoami` had listed as available logins.
6. **Resumed**: corrected `owner: 'bombastiiic'` in `app.config.ts`, re-ran `whoami` to
   reconfirm the exact match, then ran `eas init --account bombastiiic --non-interactive`
   (the `--account` flag used specifically to disambiguate personal vs. team, rather than
   relying on the CLI's own default selection in a non-interactive context).
7. **The init command exited non-zero** despite successfully creating the project server-side
   (confirmed via the printed dashboard URL) — expected, documented behavior for a dynamic
   (`app.config.ts`) config, which the CLI cannot safely auto-rewrite. Added
   `extra.eas.projectId: 'de243f7f-c6ad-4537-a799-621d645baf31'` manually, exactly per the
   CLI's own printed JSON shape.
8. **Verified the link two independent ways**, not just one: `npx expo config --type public`
   (local resolved config) and `npx eas-cli@latest project:info` (EAS's own record) — both
   agree on `@bombastiiic/familyflow` / `de243f7f-c6ad-4537-a799-621d645baf31`.
9. **Full verification re-run**: `npm run verify` (65/576, green), `npx expo-doctor` (20/21,
   same pre-existing unrelated patch drift), `npx expo export --platform ios` (clean, plus a
   re-run of the established client-bundle secret-string audit against the fresh export — no
   matches), `git diff --check` (clean).
10. **Documentation**: `docs/RELEASE_CHECKLIST.md` (EAS row marked linked with the verified
    project ID, the account-typo story recorded, version/build-number item updated, "Next
    Stage B step" rewritten from "push migration" — already done by this point — to "iOS
    signing credentials"), `docs/DEPLOYMENT.md` (EAS section 1 marked done, a stale "no EAS
    project" Known-limitations line corrected), `docs/DECISIONS.md` (new "Phase 10B EAS
    initialization" section), `knowledge/wiki/engineering/push-notifications.md` (a stale
    "genuinely greenfield" framing addressed with a note distinguishing Phase 6.1's own
    historical starting point from the current state, without rewriting the historical record
    itself).

## Deliberately not done this session

- No EAS build of any profile was run.
- No Apple credential (APNs key, signing certificate, provisioning profile) was generated.
- No App Store Connect application was created.
- Nothing was uploaded to TestFlight.
- Nothing was submitted or published anywhere.
- The `--force` flag was never used — not needed, since no conflicting project existed.

## Verification

`npm run verify` — 65 suites/576 tests (including the independently-committed
`ConflictsScreen.test.tsx` fix), lint/typecheck/wiki:lint all clean. `npx expo config --type
public` — owner/version/buildNumber/projectId all resolve correctly. `npx eas-cli@latest
project:info` — `fullName: @bombastiiic/familyflow`, `ID:
de243f7f-c6ad-4537-a799-621d645baf31`, matching the local config exactly. `npx expo-doctor` —
20/21 (pre-existing). `npx expo export --platform ios` — clean; secret-string audit against the
export found no matches. `git diff --check` — clean.
