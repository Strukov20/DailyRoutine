import type { FamilyErrorCode } from '@/lib/family/familyService';

/**
 * Maps FamilyServiceError.code to a translation key under the `family`
 * namespace. See src/domain/auth/errorMessages.ts for the established
 * pattern this mirrors.
 */
const FAMILY_ERROR_MESSAGE_KEYS: Record<FamilyErrorCode, string> = {
  forbidden: 'errors.forbidden',
  already_member: 'errors.alreadyMember',
  invalid_or_expired: 'errors.invalidOrExpiredInvitation',
  unknown: 'errors.generic',
};

export function familyErrorMessageKey(code: FamilyErrorCode): string {
  return `family:${FAMILY_ERROR_MESSAGE_KEYS[code] ?? FAMILY_ERROR_MESSAGE_KEYS.unknown}`;
}
