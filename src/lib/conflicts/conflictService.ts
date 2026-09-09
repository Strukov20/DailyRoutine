import { createLogger } from '@/lib/logger/logger';
import { supabase } from '@/lib/supabase/client';
import { mapFamilyConflictRow, type RawFamilyConflictRow } from '@/domain/conflicts/mappers';
import type { FamilyConflict } from '@/domain/conflicts/types';

const logger = createLogger('conflict-service');

/**
 * Transport-layer wrapper around `list_family_conflicts` — the only place
 * in the app that calls `supabase.rpc('list_family_conflicts', ...)`.
 * Screens go through src/domain/conflicts/hooks.ts, which goes through
 * this module. Mirrors src/lib/calendar/calendarService.ts's established
 * pattern. `list_family_conflicts` is `security definer` and itself
 * enforces family membership (see
 * supabase/migrations/20260909120000_realtime_offline_conflicts.sql) —
 * this module adds no authorization of its own, same as every other
 * service in this codebase.
 */

export type ConflictErrorCode = 'forbidden' | 'invalid_input' | 'unknown';

const CODE_BY_SQLSTATE: Record<string, ConflictErrorCode> = {
  '42501': 'forbidden',
  '22023': 'invalid_input',
  '23514': 'invalid_input',
};

export class ConflictServiceError extends Error {
  readonly code: ConflictErrorCode;

  constructor(code: ConflictErrorCode, message: string) {
    super(message);
    this.name = 'ConflictServiceError';
    this.code = code;
  }
}

function toConflictServiceError(error: unknown): ConflictServiceError {
  const sqlState = (error as { code?: string } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : 'Unknown conflict error';
  logger.warn('conflict list request failed', { sqlState, message });
  const normalized = (sqlState && CODE_BY_SQLSTATE[sqlState]) || 'unknown';
  return new ConflictServiceError(normalized, message);
}

/** Every current conflict for the family within [fromUtc, toUtc) — deterministically computed on every call, never stored server-side. */
export async function listFamilyConflicts(
  familyId: string,
  fromUtc: string,
  toUtc: string,
): Promise<FamilyConflict[]> {
  const { data, error } = await supabase.rpc('list_family_conflicts', {
    p_family_id: familyId,
    p_from: fromUtc,
    p_to: toUtc,
  });
  if (error) throw toConflictServiceError(error);
  return (data as unknown as RawFamilyConflictRow[]).map(mapFamilyConflictRow);
}
