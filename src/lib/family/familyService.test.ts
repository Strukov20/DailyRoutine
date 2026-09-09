import { supabase } from '@/lib/supabase/client';

import {
  FamilyServiceError,
  acceptFamilyInvitation,
  createChildProfile,
  createFamily,
  createFamilyInvitation,
  declineFamilyInvitation,
  deleteFamily,
  getInvitationPreview,
  leaveFamily,
  listFamilyInvitations,
  listFamilyMembers,
  listMyFamilies,
  removeFamilyMember,
  revokeFamilyInvitation,
  transferFamilyOwnership,
  updateChildProfile,
} from './familyService';

interface QueryResult {
  data: unknown;
  error: unknown;
}

// supabase-js query builders are themselves PromiseLike after any chain
// length (`await supabase.from(...).select(...)` works with no `.then()`
// called explicitly) — this stub mirrors that so familyService's chains
// resolve regardless of how many methods they call before awaiting.
function makeChain(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

describe('familyService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('reads', () => {
    it('listMyFamilies maps rows to domain Family objects', async () => {
      (supabase.from as jest.Mock).mockReturnValue(
        makeChain({
          data: [{ id: 'f1', name: 'The Smiths', owner_id: 'u1', created_at: '2026-01-01' }],
          error: null,
        }),
      );

      await expect(listMyFamilies()).resolves.toEqual([
        { id: 'f1', name: 'The Smiths', ownerId: 'u1', createdAt: '2026-01-01' },
      ]);
    });

    it('listFamilyMembers maps rows including child profiles with a null profileId', async () => {
      (supabase.from as jest.Mock).mockReturnValue(
        makeChain({
          data: [
            {
              id: 'm1',
              family_id: 'f1',
              member_type: 'child',
              role: 'child',
              profile_id: null,
              display_name: 'Kid',
              avatar_url: null,
              date_of_birth: '2020-01-01',
            },
          ],
          error: null,
        }),
      );

      await expect(listFamilyMembers('f1')).resolves.toEqual([
        {
          id: 'm1',
          familyId: 'f1',
          memberType: 'child',
          role: 'child',
          profileId: null,
          displayName: 'Kid',
          avatarUrl: null,
          dateOfBirth: '2020-01-01',
        },
      ]);
    });

    it('listFamilyInvitations maps rows and never expects a token/token_hash field', async () => {
      (supabase.from as jest.Mock).mockReturnValue(
        makeChain({
          data: [
            {
              id: 'i1',
              family_id: 'f1',
              invited_email: 'a@test.local',
              invited_by: 'u1',
              status: 'pending',
              responded_at: null,
              expires_at: '2026-02-01',
              created_at: '2026-01-25',
            },
          ],
          error: null,
        }),
      );

      await expect(listFamilyInvitations('f1')).resolves.toEqual([
        {
          id: 'i1',
          familyId: 'f1',
          invitedEmail: 'a@test.local',
          invitedBy: 'u1',
          status: 'pending',
          respondedAt: null,
          expiresAt: '2026-02-01',
          createdAt: '2026-01-25',
        },
      ]);
    });
  });

  describe('mutations', () => {
    it('createFamily returns the RPC row as familyId/familyMemberId', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [{ family_id: 'f1', family_member_id: 'm1' }],
        error: null,
      });

      await expect(createFamily('The Smiths')).resolves.toEqual({
        familyId: 'f1',
        familyMemberId: 'm1',
      });
      expect(supabase.rpc).toHaveBeenCalledWith('create_family_with_owner', {
        p_name: 'The Smiths',
      });
    });

    it('createFamilyInvitation returns the raw token exactly as the RPC returned it', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [{ invitation_id: 'i1', token: 'raw-token-value', expires_at: '2026-02-01' }],
        error: null,
      });

      await expect(createFamilyInvitation('f1', 'a@test.local')).resolves.toEqual({
        invitationId: 'i1',
        token: 'raw-token-value',
        expiresAt: '2026-02-01',
      });
      expect(supabase.rpc).toHaveBeenCalledWith('create_family_invitation', {
        p_family_id: 'f1',
        p_invited_email: 'a@test.local',
      });
    });

    it('getInvitationPreview resolves to null for an unknown token (zero rows, not an error)', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

      await expect(getInvitationPreview('unknown-token')).resolves.toBeNull();
    });

    it('getInvitationPreview maps a found row to the sanitized preview shape', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [
          {
            family_name: 'The Smiths',
            invited_by_display_name: 'Mom',
            status: 'pending',
            expires_at: '2026-02-01',
            is_valid: true,
          },
        ],
        error: null,
      });

      await expect(getInvitationPreview('a-token')).resolves.toEqual({
        familyName: 'The Smiths',
        invitedByDisplayName: 'Mom',
        status: 'pending',
        expiresAt: '2026-02-01',
        isValid: true,
      });
    });

    it('acceptFamilyInvitation returns the new membership', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: [{ family_id: 'f1', family_member_id: 'm2' }],
        error: null,
      });

      await expect(acceptFamilyInvitation('a-token')).resolves.toEqual({
        familyId: 'f1',
        familyMemberId: 'm2',
      });
    });

    it('declineFamilyInvitation and revokeFamilyInvitation resolve on success', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      await expect(declineFamilyInvitation('a-token')).resolves.toBeUndefined();
      await expect(revokeFamilyInvitation('i1')).resolves.toBeUndefined();
    });

    it('createChildProfile returns the new member id', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'm3', error: null });

      await expect(createChildProfile({ familyId: 'f1', displayName: 'Kid Two' })).resolves.toBe(
        'm3',
      );
    });

    it('updateChildProfile and removeFamilyMember resolve on success', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      await expect(
        updateChildProfile({ memberId: 'm3', displayName: 'Renamed' }),
      ).resolves.toBeUndefined();
      await expect(removeFamilyMember('m3')).resolves.toBeUndefined();
    });

    it('transferFamilyOwnership calls transfer_family_ownership with the family and target member id', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      await expect(transferFamilyOwnership('f1', 'm2')).resolves.toBeUndefined();
      expect(supabase.rpc).toHaveBeenCalledWith('transfer_family_ownership', {
        p_family_id: 'f1',
        p_new_owner_member_id: 'm2',
      });
    });

    it('deleteFamily calls delete_family and leaveFamily calls leave_family, both with the family id', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      await expect(deleteFamily('f1')).resolves.toBeUndefined();
      expect(supabase.rpc).toHaveBeenCalledWith('delete_family', { p_family_id: 'f1' });

      await expect(leaveFamily('f1')).resolves.toBeUndefined();
      expect(supabase.rpc).toHaveBeenCalledWith('leave_family', { p_family_id: 'f1' });
    });

    it('transferFamilyOwnership/deleteFamily/leaveFamily normalize RPC errors the same way as every other mutation', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: { code: '42501', message: 'nope' } });

      await expect(transferFamilyOwnership('f1', 'm2')).rejects.toBeInstanceOf(FamilyServiceError);
      await expect(deleteFamily('f1')).rejects.toBeInstanceOf(FamilyServiceError);
      await expect(leaveFamily('f1')).rejects.toBeInstanceOf(FamilyServiceError);
    });
  });

  describe('error normalization', () => {
    it.each([
      ['42501', 'forbidden'],
      ['23505', 'already_member'],
      ['22023', 'invalid_or_expired'],
      ['some_unmapped_code', 'unknown'],
    ])('maps SQLSTATE %s to FamilyErrorCode %s', async (sqlState, expectedCode) => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { code: sqlState, message: 'boom' },
      });

      let caught: unknown;
      try {
        await createFamily('x');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(FamilyServiceError);
      expect((caught as FamilyServiceError).code).toBe(expectedCode);
    });

    it('throws FamilyServiceError("unknown") if an RPC that must return one row returns none', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

      let caught: unknown;
      try {
        await createFamily('x');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(FamilyServiceError);
      expect((caught as FamilyServiceError).code).toBe('unknown');
    });
  });
});
