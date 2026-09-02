import type { FamilyErrorCode } from '@/lib/family/familyService';

import { familyErrorMessageKey } from './errorMessages';

const ALL_CODES: FamilyErrorCode[] = [
  'forbidden',
  'already_member',
  'invalid_or_expired',
  'unknown',
];

describe('familyErrorMessageKey', () => {
  it('maps every FamilyErrorCode to a distinct family: translation key', () => {
    const keys = ALL_CODES.map(familyErrorMessageKey);

    for (const key of keys) {
      expect(key).toMatch(/^family:errors\./);
    }
    expect(new Set(keys).size).toBe(ALL_CODES.length);
  });

  it('falls back to the generic key for an unrecognized code', () => {
    // @ts-expect-error deliberately passing an invalid code to prove the fallback
    expect(familyErrorMessageKey('not_a_real_code')).toBe('family:errors.generic');
  });
});
