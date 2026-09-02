import type { AuthErrorCode } from '@/lib/auth/authService';

import { authErrorMessageKey } from './errorMessages';

const ALL_CODES: AuthErrorCode[] = [
  'invalid_credentials',
  'user_already_exists',
  'weak_password',
  'email_not_confirmed',
  'over_email_send_rate_limit',
  'same_password',
  'session_expired',
  'not_configured',
  'unknown',
];

describe('authErrorMessageKey', () => {
  it('maps every AuthErrorCode to a distinct auth: translation key', () => {
    const keys = ALL_CODES.map(authErrorMessageKey);

    for (const key of keys) {
      expect(key).toMatch(/^auth:errors\./);
    }
    expect(new Set(keys).size).toBe(ALL_CODES.length);
  });

  it('falls back to the generic key for an unrecognized code', () => {
    // @ts-expect-error deliberately passing an invalid code to prove the fallback
    expect(authErrorMessageKey('not_a_real_code')).toBe('auth:errors.generic');
  });
});
