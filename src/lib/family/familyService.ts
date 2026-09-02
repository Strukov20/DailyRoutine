import { supabase } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger/logger';
import {
  mapFamilyInvitationRow,
  mapFamilyMemberRow,
  mapFamilyRow,
  mapInvitationPreviewRow,
} from '@/domain/family/mappers';
import type {
  CreatedInvitation,
  Family,
  FamilyInvitation,
  FamilyMember,
  InvitationPreview,
} from '@/domain/family/types';

const logger = createLogger('family-service');

/**
 * Transport-layer wrapper around the family/invitation/child-profile RPCs
 * and their supporting reads — the only place in the app that calls
 * `supabase.rpc(...)` or `supabase.from('families' | 'family_members' |
 * 'family_invitations')` directly. Screens go through
 * src/domain/family/hooks.ts, which goes through this module. See
 * src/lib/auth/authService.ts for the established pattern this mirrors,
 * and docs/ARCHITECTURE.md for the layering rule.
 *
 * Every mutation here is a narrowly scoped SECURITY DEFINER RPC — see
 * supabase/migrations/20260903120000_family_management.sql — never a raw
 * table INSERT/UPDATE/DELETE, because families/family_members intentionally
 * have no such grant for `authenticated`.
 */

export type FamilyErrorCode = 'forbidden' | 'already_member' | 'invalid_or_expired' | 'unknown';

const CODE_BY_SQLSTATE: Record<string, FamilyErrorCode> = {
  '42501': 'forbidden',
  '23505': 'already_member',
  '22023': 'invalid_or_expired',
};

export class FamilyServiceError extends Error {
  readonly code: FamilyErrorCode;

  constructor(code: FamilyErrorCode, message: string) {
    super(message);
    this.name = 'FamilyServiceError';
    this.code = code;
  }
}

function toFamilyServiceError(error: unknown): FamilyServiceError {
  const sqlState = (error as { code?: string } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : 'Unknown family error';
  logger.warn('family request failed', { sqlState, message });
  const normalized = (sqlState && CODE_BY_SQLSTATE[sqlState]) || 'unknown';
  return new FamilyServiceError(normalized, message);
}

/** Every RPC below that `returns table (...)` always returns exactly one row on success. */
function expectOneRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new FamilyServiceError('unknown', 'Expected RPC to return one row, got none');
  return row;
}

/** Families the caller is a member of — RLS scopes this, no filter needed. */
export async function listMyFamilies(): Promise<Family[]> {
  const { data, error } = await supabase.from('families').select('*').order('created_at');
  if (error) throw toFamilyServiceError(error);
  return data.map(mapFamilyRow);
}

export async function listFamilyMembers(familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at');
  if (error) throw toFamilyServiceError(error);
  return data.map(mapFamilyMemberRow);
}

/** Owner-only per RLS — returns an empty list for a non-owner member. */
export async function listFamilyInvitations(familyId: string): Promise<FamilyInvitation[]> {
  const { data, error } = await supabase
    .from('family_invitations')
    .select(
      'id, family_id, invited_email, invited_by, status, responded_at, expires_at, created_at',
    )
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });
  if (error) throw toFamilyServiceError(error);
  return data.map(mapFamilyInvitationRow);
}

export interface CreateFamilyResult {
  familyId: string;
  familyMemberId: string;
}

export async function createFamily(name: string): Promise<CreateFamilyResult> {
  const { data, error } = await supabase.rpc('create_family_with_owner', { p_name: name });
  if (error) throw toFamilyServiceError(error);
  const row = expectOneRow(data);
  return { familyId: row.family_id, familyMemberId: row.family_member_id };
}

export async function createFamilyInvitation(
  familyId: string,
  invitedEmail: string,
): Promise<CreatedInvitation> {
  const { data, error } = await supabase.rpc('create_family_invitation', {
    p_family_id: familyId,
    p_invited_email: invitedEmail,
  });
  if (error) throw toFamilyServiceError(error);
  const row = expectOneRow(data);
  return { invitationId: row.invitation_id, token: row.token, expiresAt: row.expires_at };
}

export async function getInvitationPreview(token: string): Promise<InvitationPreview | null> {
  const { data, error } = await supabase.rpc('get_family_invitation_preview', { p_token: token });
  if (error) throw toFamilyServiceError(error);
  return data[0] ? mapInvitationPreviewRow(data[0]) : null;
}

export interface AcceptInvitationResult {
  familyId: string;
  familyMemberId: string;
}

export async function acceptFamilyInvitation(token: string): Promise<AcceptInvitationResult> {
  const { data, error } = await supabase.rpc('accept_family_invitation', { p_token: token });
  if (error) throw toFamilyServiceError(error);
  const row = expectOneRow(data);
  return { familyId: row.family_id, familyMemberId: row.family_member_id };
}

export async function declineFamilyInvitation(token: string): Promise<void> {
  const { error } = await supabase.rpc('decline_family_invitation', { p_token: token });
  if (error) throw toFamilyServiceError(error);
}

export async function revokeFamilyInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_family_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw toFamilyServiceError(error);
}

export interface CreateChildProfileParams {
  familyId: string;
  displayName: string;
  dateOfBirth?: string;
}

export async function createChildProfile(params: CreateChildProfileParams): Promise<string> {
  const { data, error } = await supabase.rpc('create_child_profile', {
    p_family_id: params.familyId,
    p_display_name: params.displayName,
    p_date_of_birth: params.dateOfBirth,
  });
  if (error) throw toFamilyServiceError(error);
  return data;
}

export interface UpdateChildProfileParams {
  memberId: string;
  displayName: string;
  dateOfBirth?: string;
}

export async function updateChildProfile(params: UpdateChildProfileParams): Promise<void> {
  const { error } = await supabase.rpc('update_child_profile', {
    p_member_id: params.memberId,
    p_display_name: params.displayName,
    p_date_of_birth: params.dateOfBirth,
  });
  if (error) throw toFamilyServiceError(error);
}

export async function removeFamilyMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_family_member', { p_member_id: memberId });
  if (error) throw toFamilyServiceError(error);
}
