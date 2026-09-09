import { supabase } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger/logger';

const logger = createLogger('profile-service');

/**
 * Transport-layer wrapper for account-level (not family-scoped) RPCs — see
 * supabase/migrations/20260912120000_release_safety_ownership_and_deletion.sql
 * for the full server-side design. Mirrors src/lib/family/familyService.ts's
 * own pattern (never a raw table write, never called directly from a
 * screen — see docs/ARCHITECTURE.md, the transport/domain/UI boundary).
 */

export type ProfileErrorCode = 'forbidden' | 'still_owns_a_family' | 'unknown';

const CODE_BY_SQLSTATE: Record<string, ProfileErrorCode> = {
  '42501': 'forbidden',
  '22023': 'still_owns_a_family',
};

export class ProfileServiceError extends Error {
  readonly code: ProfileErrorCode;

  constructor(code: ProfileErrorCode, message: string) {
    super(message);
    this.name = 'ProfileServiceError';
    this.code = code;
  }
}

function toProfileServiceError(error: unknown): ProfileServiceError {
  const sqlState = (error as { code?: string } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : 'Unknown profile error';
  logger.warn('profile request failed', { sqlState, message });
  const normalized = (sqlState && CODE_BY_SQLSTATE[sqlState]) || 'unknown';
  return new ProfileServiceError(normalized, message);
}

/**
 * Self-service account deletion. Blocks (ProfileServiceError with code
 * 'still_owns_a_family') if the caller currently owns any family —
 * transfer ownership or delete the family first. On success, the caller's
 * own profile is anonymized server-side (never hard-deleted — see the
 * migration's own header comment for why) and every family membership,
 * private task/event, and device token is cleaned up. The caller's
 * `auth.users` row and session are untouched by this call — the UI must
 * still call `signOut()` right after, same as any other sign-out, to
 * actually end the session (see app/(app)/profile.tsx's own account-
 * deletion flow).
 */
export async function requestAccountDeletion(): Promise<void> {
  const { error } = await supabase.rpc('request_account_deletion');
  if (error) throw toProfileServiceError(error);
}
