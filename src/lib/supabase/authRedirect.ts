import * as Linking from 'expo-linking';

/**
 * Builds the deep link Supabase Auth should redirect back to after an
 * email-confirmation link, password-recovery link, or OAuth flow completes.
 * Uses the app's own scheme (src/config/app-info.json) — never a hosted web
 * URL, since FamilyFlow has no web frontend (see docs/ARCHITECTURE.md).
 *
 * These exact paths (`confirm`, `reset-password`, `auth-callback`) must
 * match the routes under app/(auth)/ and the redirect URLs configured in
 * supabase/config.toml's `auth.additional_redirect_urls`.
 */
export function makeAuthRedirectUri(path: 'confirm' | 'reset-password' | 'auth-callback'): string {
  return Linking.createURL(path);
}
