import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger/logger';
import { supabase } from '@/lib/supabase/client';
import { makeAuthRedirectUri } from '@/lib/supabase/authRedirect';

import { exchangeCodeForSession } from './authService';

const logger = createLogger('oauth');

/**
 * Google/Apple sign-in, architecturally complete and ready to use — but
 * config-gated. Real credentials (a Google Cloud OAuth client, an Apple
 * Services ID + key) have to be created and wired into
 * supabase/config.toml's `auth.external.*` blocks before either provider
 * actually works; see docs/DECISIONS.md, "Google and Apple Auth", for the
 * exact manual steps. Until then these env flags default to false, the
 * corresponding sign-in buttons stay hidden (see app/(auth)/sign-in.tsx),
 * and calling either function throws `not_configured` rather than
 * pretending to work.
 */
export const isGoogleAuthEnabled = env.EXPO_PUBLIC_AUTH_GOOGLE_ENABLED;
export const isAppleAuthEnabled = env.EXPO_PUBLIC_AUTH_APPLE_ENABLED;

class OAuthNotConfiguredError extends Error {
  readonly code = 'not_configured' as const;
  constructor(provider: string) {
    super(`${provider} sign-in is not configured`);
    this.name = 'OAuthNotConfiguredError';
  }
}

async function signInWithProvider(provider: 'google' | 'apple'): Promise<void> {
  const redirectTo = makeAuthRedirectUri('auth-callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) {
    logger.warn(`${provider} sign-in failed to start`, { message: error.message });
    throw error;
  }
  if (!data.url) {
    throw new Error(`Supabase did not return an OAuth URL for ${provider}`);
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    // User cancelled or dismissed the browser sheet — not an error to surface.
    logger.info(`${provider} sign-in was cancelled`, { resultType: result.type });
    return;
  }

  const { queryParams } = Linking.parse(result.url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
  if (!code) {
    throw new Error(`${provider} redirect did not include an authorization code`);
  }
  await exchangeCodeForSession(code);
}

export async function signInWithGoogle(): Promise<void> {
  if (!isGoogleAuthEnabled) throw new OAuthNotConfiguredError('Google');
  return signInWithProvider('google');
}

export async function signInWithApple(): Promise<void> {
  if (!isAppleAuthEnabled) throw new OAuthNotConfiguredError('Apple');
  return signInWithProvider('apple');
}
