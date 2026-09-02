import { supabase } from '@/lib/supabase/client';
import { makeAuthRedirectUri } from '@/lib/supabase/authRedirect';
import { createLogger } from '@/lib/logger/logger';

const logger = createLogger('auth-service');

/**
 * Transport-layer wrapper around supabase.auth.* — the only place in the
 * app that calls it directly. Screens/hooks go through this module (or
 * AuthProvider, which itself only calls this module), never `supabase.auth`
 * directly. See docs/ARCHITECTURE.md, the Supabase-transport/domain/UI
 * boundary.
 *
 * Errors are normalized to AuthServiceError with a stable `code` — never a
 * raw GoTrue message — so UI code maps codes to translated strings instead
 * of displaying backend English text (see app/(auth)/sign-in.tsx et al.).
 */

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'user_already_exists'
  | 'weak_password'
  | 'email_not_confirmed'
  | 'over_email_send_rate_limit'
  | 'same_password'
  | 'session_expired'
  | 'not_configured'
  | 'unknown';

const KNOWN_CODES: readonly AuthErrorCode[] = [
  'invalid_credentials',
  'user_already_exists',
  'weak_password',
  'email_not_confirmed',
  'over_email_send_rate_limit',
  'same_password',
  'session_expired',
];

export class AuthServiceError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthServiceError';
    this.code = code;
  }
}

function toAuthServiceError(error: unknown): AuthServiceError {
  const code = (error as { code?: string } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : 'Unknown auth error';
  logger.warn('auth request failed', { code, message });
  const normalized = KNOWN_CODES.find((known) => known === code) ?? 'unknown';
  return new AuthServiceError(normalized, message);
}

export interface SignUpParams {
  email: string;
  password: string;
  displayName: string;
}

export async function signUpWithPassword(params: SignUpParams): Promise<void> {
  const { error } = await supabase.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      data: { display_name: params.displayName },
      emailRedirectTo: makeAuthRedirectUri('confirm'),
    },
  });
  if (error) throw toAuthServiceError(error);
}

export interface SignInParams {
  email: string;
  password: string;
}

export async function signInWithPassword(params: SignInParams): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword(params);
  if (error) throw toAuthServiceError(error);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw toAuthServiceError(error);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: makeAuthRedirectUri('reset-password'),
  });
  if (error) throw toAuthServiceError(error);
}

export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw toAuthServiceError(error);
}

/**
 * Completes a PKCE deep-link flow (email confirmation or password
 * recovery) by exchanging the `code` query param Supabase Auth appended to
 * the redirect URL for a real session.
 */
export async function exchangeCodeForSession(code: string): Promise<void> {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw toAuthServiceError(error);
}
