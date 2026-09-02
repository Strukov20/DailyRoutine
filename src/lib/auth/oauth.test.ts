import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase/client';

import {
  isAppleAuthEnabled,
  isGoogleAuthEnabled,
  signInWithApple,
  signInWithGoogle,
} from './oauth';

jest.mock('@/lib/env', () => ({
  env: {
    EXPO_PUBLIC_AUTH_GOOGLE_ENABLED: false,
    EXPO_PUBLIC_AUTH_APPLE_ENABLED: false,
  },
}));

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithOAuth: jest.fn(),
    },
  },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('@/lib/supabase/authRedirect', () => ({
  makeAuthRedirectUri: (path: string) => `familyflow://${path}`,
}));

describe('oauth (unavailable provider configuration)', () => {
  it('reports both providers as disabled when their env flags are unset', () => {
    expect(isGoogleAuthEnabled).toBe(false);
    expect(isAppleAuthEnabled).toBe(false);
  });

  it('signInWithGoogle throws a not_configured error instead of attempting a fake sign-in', async () => {
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'not_configured' });
    expect(supabase.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('signInWithApple throws a not_configured error instead of attempting a fake sign-in', async () => {
    await expect(signInWithApple()).rejects.toMatchObject({ code: 'not_configured' });
    expect(supabase.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it('never calls the browser session when a provider is disabled', () => {
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });
});
