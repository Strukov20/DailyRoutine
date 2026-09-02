import { mapFamilyInvitationRow, mapFamilyMemberRow, mapFamilyRow } from './mappers';

describe('mapFamilyRow', () => {
  it('maps a families row 1:1', () => {
    expect(
      mapFamilyRow({
        id: 'f1',
        name: 'The Smiths',
        owner_id: 'u1',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        created_by: 'u1',
      }),
    ).toEqual({ id: 'f1', name: 'The Smiths', ownerId: 'u1', createdAt: '2026-01-01' });
  });
});

describe('mapFamilyMemberRow', () => {
  const baseRow = {
    id: 'm1',
    family_id: 'f1',
    profile_id: null,
    display_name: 'Kid',
    avatar_url: null,
    date_of_birth: null,
    invited_by: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    created_by: 'u1',
  };

  it('maps a normal adult/owner row through unchanged', () => {
    expect(
      mapFamilyMemberRow({ ...baseRow, member_type: 'adult', role: 'owner', profile_id: 'u1' }),
    ).toMatchObject({ memberType: 'adult', role: 'owner', profileId: 'u1' });
  });

  it('falls back safely to "adult" for an unrecognized member_type value', () => {
    // CHECK constraints aren't reflected in the generated row type, so this
    // simulates a value the DB would actually reject — the mapper must not
    // throw on it.
    expect(mapFamilyMemberRow({ ...baseRow, member_type: 'robot', role: 'owner' })).toMatchObject({
      memberType: 'adult',
    });
  });

  it('falls back safely to "adult" for an unrecognized role value', () => {
    expect(mapFamilyMemberRow({ ...baseRow, member_type: 'adult', role: 'admin' })).toMatchObject({
      role: 'adult',
    });
  });
});

describe('mapFamilyInvitationRow', () => {
  it('never expects or reads a token/token_hash field', () => {
    const row = {
      id: 'i1',
      family_id: 'f1',
      invited_email: 'a@test.local',
      invited_by: 'u1',
      status: 'pending',
      responded_at: null,
      expires_at: '2026-02-01',
      created_at: '2026-01-25',
    };

    expect(mapFamilyInvitationRow(row)).toEqual({
      id: 'i1',
      familyId: 'f1',
      invitedEmail: 'a@test.local',
      invitedBy: 'u1',
      status: 'pending',
      respondedAt: null,
      expiresAt: '2026-02-01',
      createdAt: '2026-01-25',
    });
    expect(Object.keys(mapFamilyInvitationRow(row))).not.toContain('token');
  });

  it('falls back safely to "expired" for an unrecognized status value', () => {
    const row = {
      id: 'i1',
      family_id: 'f1',
      invited_email: 'a@test.local',
      invited_by: 'u1',
      status: 'not_a_real_status',
      responded_at: null,
      expires_at: '2026-02-01',
      created_at: '2026-01-25',
    };

    expect(mapFamilyInvitationRow(row).status).toBe('expired');
  });
});
