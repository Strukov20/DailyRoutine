import type { AuthErrorCode } from '@/lib/auth/authService';

/**
 * Maps AuthServiceError.code to a translation key under the `auth`
 * namespace's `errors` object. Keeping this table in domain/ (not inside
 * each screen) means every screen shows the same wording for the same
 * failure, and adding a new mapped code is a one-line change.
 */
const AUTH_ERROR_MESSAGE_KEYS: Record<AuthErrorCode, string> = {
  invalid_credentials: 'errors.invalidCredentials',
  user_already_exists: 'errors.userAlreadyExists',
  weak_password: 'errors.weakPassword',
  email_not_confirmed: 'errors.emailNotConfirmed',
  over_email_send_rate_limit: 'errors.rateLimited',
  same_password: 'errors.samePassword',
  session_expired: 'errors.sessionExpired',
  not_configured: 'errors.notConfigured',
  unknown: 'errors.generic',
};

export function authErrorMessageKey(code: AuthErrorCode): string {
  return `auth:${AUTH_ERROR_MESSAGE_KEYS[code] ?? AUTH_ERROR_MESSAGE_KEYS.unknown}`;
}
