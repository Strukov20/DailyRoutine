/**
 * Domain shapes for families, family members, and invitations —
 * deliberately decoupled from the generated Supabase row shapes (see
 * src/lib/supabase/types.ts) so screens never import database types
 * directly. See docs/ARCHITECTURE.md, "Supabase transport / domain models /
 * UI view models" boundary, and src/domain/profile/types.ts for the
 * established pattern this mirrors.
 */

export interface Family {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
}

export type FamilyMemberType = 'adult' | 'child';
export type FamilyMemberRole = 'owner' | 'adult' | 'child';

export interface FamilyMember {
  id: string;
  familyId: string;
  memberType: FamilyMemberType;
  role: FamilyMemberRole;
  /** null for an unlinked child profile — see docs/DATA_MODEL.md. */
  profileId: string | null;
  displayName: string;
  avatarUrl: string | null;
  /** Child profiles only. */
  dateOfBirth: string | null;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';

/**
 * The owner's own view of an invitation they sent — never includes the
 * token or its hash (see supabase/migrations/20260903120000_family_management.sql,
 * the column-level grant that excludes token_hash).
 */
export interface FamilyInvitation {
  id: string;
  familyId: string;
  invitedEmail: string;
  invitedBy: string;
  status: InvitationStatus;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
}

/**
 * What create_family_invitation returns: the raw token, exactly once, for
 * building a deep link / Share payload. Never persisted client-side beyond
 * the current screen's state.
 */
export interface CreatedInvitation {
  invitationId: string;
  token: string;
  expiresAt: string;
}

/**
 * The sanitized projection anyone holding a token sees — no member list, no
 * email, no token. See get_family_invitation_preview().
 */
export interface InvitationPreview {
  familyName: string;
  invitedByDisplayName: string;
  status: InvitationStatus;
  expiresAt: string;
  isValid: boolean;
}
