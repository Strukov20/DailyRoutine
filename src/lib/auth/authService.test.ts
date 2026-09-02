import { supabase } from '@/lib/supabase/client';

import {
  AuthServiceError,
  requestPasswordReset,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  updatePassword,
} from './authService';

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
      exchangeCodeForSession: jest.fn(),
    },
  },
}));

jest.mock('@/lib/supabase/authRedirect', () => ({
  makeAuthRedirectUri: (path: string) => `familyflow://${path}`,
}));

describe('authService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('resolves silently on a successful sign-in', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({ data: {}, error: null });

    await expect(
      signInWithPassword({ email: 'a@test.local', password: 'password123' }),
    ).resolves.toBeUndefined();
  });

  it('maps a recognized GoTrue error code to the matching AuthServiceError code (localized error path)', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
      data: {},
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });

    await expect(
      signInWithPassword({ email: 'a@test.local', password: 'wrong' }),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('falls back to "unknown" for an unrecognized error code, never leaking the raw code as-is', async () => {
    (supabase.auth.signInWithPassword as jest.Mock).mockResolvedValue({
      data: {},
      error: { code: 'some_new_gotrue_code_we_do_not_map_yet', message: 'boom' },
    });

    let caught: unknown;
    try {
      await signInWithPassword({ email: 'a@test.local', password: 'x' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthServiceError);
    expect((caught as AuthServiceError).code).toBe('unknown');
  });

  it('signUpWithPassword sends the redirect URL and display name metadata', async () => {
    (supabase.auth.signUp as jest.Mock).mockResolvedValue({ data: {}, error: null });

    await signUpWithPassword({ email: 'a@test.local', password: 'password123', displayName: 'A' });

    expect(supabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@test.local',
        options: expect.objectContaining({
          data: { display_name: 'A' },
          emailRedirectTo: 'familyflow://confirm',
        }),
      }),
    );
  });

  it('requestPasswordReset sends the reset-password redirect URL', async () => {
    (supabase.auth.resetPasswordForEmail as jest.Mock).mockResolvedValue({ error: null });

    await requestPasswordReset('a@test.local');

    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      'a@test.local',
      expect.objectContaining({ redirectTo: 'familyflow://reset-password' }),
    );
  });

  it('signOut propagates a mapped error on failure', async () => {
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({
      error: { code: 'session_expired', message: 'Session expired' },
    });

    await expect(signOut()).rejects.toMatchObject({ code: 'session_expired' });
  });

  it('updatePassword resolves silently on success', async () => {
    (supabase.auth.updateUser as jest.Mock).mockResolvedValue({ data: {}, error: null });

    await expect(updatePassword('new-password-123')).resolves.toBeUndefined();
  });
});
