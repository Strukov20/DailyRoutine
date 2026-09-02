import type { Tables } from '@/lib/supabase/types';

import type {
  Family,
  FamilyInvitation,
  FamilyMember,
  FamilyMemberRole,
  FamilyMemberType,
  InvitationPreview,
  InvitationStatus,
} from './types';

// The generated Database type widens CHECK-constrained columns to plain
// `string` — see src/domain/profile/mappers.ts for why these narrowing
// helpers exist and why they fall back to a safe default instead of
// throwing on an unexpected value.
const MEMBER_TYPES: readonly FamilyMemberType[] = ['adult', 'child'];
const MEMBER_ROLES: readonly FamilyMemberRole[] = ['owner', 'adult', 'child'];
const INVITATION_STATUSES: readonly InvitationStatus[] = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'revoked',
];

function asMemberType(value: string): FamilyMemberType {
  return (MEMBER_TYPES as readonly string[]).includes(value)
    ? (value as FamilyMemberType)
    : 'adult';
}

function asMemberRole(value: string): FamilyMemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(value)
    ? (value as FamilyMemberRole)
    : 'adult';
}

function asInvitationStatus(value: string): InvitationStatus {
  return (INVITATION_STATUSES as readonly string[]).includes(value)
    ? (value as InvitationStatus)
    : 'expired';
}

export function mapFamilyRow(row: Tables<'families'>): Family {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}

export function mapFamilyMemberRow(row: Tables<'family_members'>): FamilyMember {
  return {
    id: row.id,
    familyId: row.family_id,
    memberType: asMemberType(row.member_type),
    role: asMemberRole(row.role),
    profileId: row.profile_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    dateOfBirth: row.date_of_birth,
  };
}

// family_invitations' column-level grant excludes token_hash (see the
// Phase 3 migration) — familyService selects an explicit column list that
// omits it, so this takes that narrower shape rather than the full
// generated row type, which still includes token_hash/created_by/updated_at.
type FamilyInvitationRow = Pick<
  Tables<'family_invitations'>,
  | 'id'
  | 'family_id'
  | 'invited_email'
  | 'invited_by'
  | 'status'
  | 'responded_at'
  | 'expires_at'
  | 'created_at'
>;

export function mapFamilyInvitationRow(row: FamilyInvitationRow): FamilyInvitation {
  return {
    id: row.id,
    familyId: row.family_id,
    invitedEmail: row.invited_email,
    invitedBy: row.invited_by,
    status: asInvitationStatus(row.status),
    expiresAt: row.expires_at,
    respondedAt: row.responded_at,
    createdAt: row.created_at,
  };
}

interface InvitationPreviewRow {
  family_name: string;
  invited_by_display_name: string;
  status: string;
  expires_at: string;
  is_valid: boolean;
}

export function mapInvitationPreviewRow(row: InvitationPreviewRow): InvitationPreview {
  return {
    familyName: row.family_name,
    invitedByDisplayName: row.invited_by_display_name,
    status: asInvitationStatus(row.status),
    expiresAt: row.expires_at,
    isValid: row.is_valid,
  };
}
