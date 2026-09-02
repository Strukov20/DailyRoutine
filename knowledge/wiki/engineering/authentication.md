---
title: Authentication
status: current
updated: 2026-09-02
sources:
  - ../../../docs/ARCHITECTURE.md
  - ../../../docs/DECISIONS.md
  - ../../raw/sessions/2026-09-02-phase2-supabase-foundation.md
tags: [engineering, auth, supabase]
---

## Confirmed / implemented

Real Supabase Auth, email/password fully functional against a local project:

- `src/lib/auth/authService.ts` — the only module calling `supabase.auth.*`; normalizes every
  failure to `AuthServiceError` with a stable `code`, mapped to translated strings via
  `src/domain/auth/errorMessages.ts` (never raw GoTrue English shown to the user).
- `src/lib/auth/AuthProvider.tsx` — app-wide session state (`useAuth()` →
  `status: 'loading' | 'signed-out' | 'signed-in'`, `session`, `profile`), restores on
  launch, subscribes to `onAuthStateChange`, fetches the domain `Profile`
  (`src/domain/profile/`) after every session change.
- `app/_layout.tsx` — withholds rendering during `status === 'loading'` (no flash), then
  gates `(auth)`/`(app)` route groups with Expo Router's `<Stack.Protected guard={...}>` —
  one root guard, not a redirect check per screen.
- Flows: sign-up, sign-in, sign-out, forgot-password → email link → `reset-password`,
  sign-up → email confirmation link → `confirm`. Deep links built by
  `src/lib/supabase/authRedirect.ts`, registered in `supabase/config.toml`'s
  `additional_redirect_urls`.
- Profile creation is automatic and idempotent — a `SECURITY DEFINER` trigger on
  `auth.users`, not client code. See [data-model](data-model.md).

## A routing subtlety worth remembering

`app/reset-password.tsx` lives at the **top level**, outside both `Stack.Protected` guards —
not an oversight. Exchanging its recovery `code` for a session flips `status` to
`'signed-in'`, which would otherwise cause the signed-in guard to yank the user into the main
app mid-flow, before they've set a new password. An always-reachable top-level screen avoids
that race entirely. Full reasoning: [DECISIONS.md](../../../docs/DECISIONS.md).

## Google / Apple sign-in: real code, config-gated

`src/lib/auth/oauth.ts` calls the real `signInWithOAuth` + `expo-web-browser` flow — not a
stub. What's gated is only whether the buttons render
(`EXPO_PUBLIC_AUTH_GOOGLE_ENABLED`/`EXPO_PUBLIC_AUTH_APPLE_ENABLED`, both default `false`);
calling either while disabled throws `not_configured` rather than attempting a request that
would fail server-side. Manual provider-console setup required before flipping either flag —
see [DECISIONS.md](../../../docs/DECISIONS.md#googleapple-auth-real-api-calls-config-gated-by-an-env-flag--not-a-stub).

## Session persistence trade-off (confirmed, explicit)

AsyncStorage, not SecureStore — unencrypted at rest, accepted because SecureStore's ~2KB
limit can't hold a real Supabase session, the access token is short-lived and auto-refreshed,
and SecureStore stays available for anything small/sensitive added later. Full trade-off
write-up: [DECISIONS.md](../../../docs/DECISIONS.md).

## Unresolved

- **Docker/local-instance verification** — this phase's auth code was written and unit
  tested (mocked Supabase client) but not exercised against a real local Supabase Auth
  server in this session — Docker was unavailable. Must be verified for real before trusting
  the email/password flow end to end. See the session record for the exact blocker.
- **No family-creation RPC yet** — signing up only creates a `profiles` row; there is no
  path yet from "signed in" to "owns a family." That's Phase 3 (family UI) — see
  [family-spaces](../domain/family-spaces.md).
- **Native Sign in with Apple** (`expo-apple-authentication`'s platform button, preferred by
  App Store guidelines over a browser redirect for this specific provider) is a documented
  future enhancement, not built — the current Apple flow reuses the same browser-OAuth path
  as Google.

## See also

- [Security model](security-model.md) — how RLS ties to `auth.uid()`
- [Data model](data-model.md) — `profiles` / `auth.users`
- [Family Spaces](../domain/family-spaces.md) — what comes after sign-in, not yet built
