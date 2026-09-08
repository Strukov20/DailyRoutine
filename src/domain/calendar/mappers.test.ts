import {
  mapEventRow,
  mapFamilyResponsibilityRow,
  mapFamilyScheduleRow,
  mapResponsibilityRow,
  type RawEventRow,
  type RawFamilyResponsibilityRow,
  type RawFamilyScheduleRow,
  type RawResponsibilityRow,
} from './mappers';

describe('mapEventRow', () => {
  it('maps every column and narrows visibility', () => {
    const row: RawEventRow = {
      id: 'e1',
      owner_profile_id: 'p1',
      family_id: 'f1',
      title: 'Swimming',
      description: null,
      location: null,
      starts_at: '2026-09-15T17:00:00Z',
      ends_at: '2026-09-15T18:00:00Z',
      timezone: 'Europe/Kyiv',
      visibility: 'family',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };
    expect(mapEventRow(row)).toEqual({
      id: 'e1',
      ownerProfileId: 'p1',
      familyId: 'f1',
      title: 'Swimming',
      description: null,
      location: null,
      startsAt: '2026-09-15T17:00:00Z',
      endsAt: '2026-09-15T18:00:00Z',
      timezone: 'Europe/Kyiv',
      visibility: 'family',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    });
  });

  it('falls back to "private" for an unrecognized visibility value', () => {
    const row: RawEventRow = {
      id: 'e1',
      owner_profile_id: 'p1',
      family_id: null,
      title: 'X',
      description: null,
      location: null,
      starts_at: '2026-09-15T17:00:00Z',
      ends_at: '2026-09-15T18:00:00Z',
      timezone: 'UTC',
      visibility: 'something_unexpected',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };
    expect(mapEventRow(row).visibility).toBe('private');
  });
});

describe('mapResponsibilityRow', () => {
  it('maps every column and narrows type/status', () => {
    const row: RawResponsibilityRow = {
      id: 'r1',
      event_id: 'e1',
      family_id: 'f1',
      type: 'drop_off',
      label: null,
      assignee_member_id: 'm1',
      status: 'accepted',
    };
    expect(mapResponsibilityRow(row)).toEqual({
      id: 'r1',
      eventId: 'e1',
      familyId: 'f1',
      type: 'drop_off',
      label: null,
      assigneeMemberId: 'm1',
      status: 'accepted',
    });
  });

  it('falls back to "custom"/"unassigned" for unrecognized type/status values', () => {
    const row: RawResponsibilityRow = {
      id: 'r1',
      event_id: 'e1',
      family_id: 'f1',
      type: 'unexpected_type',
      label: null,
      assignee_member_id: null,
      status: 'unexpected_status',
    };
    const mapped = mapResponsibilityRow(row);
    expect(mapped.type).toBe('custom');
    expect(mapped.status).toBe('unassigned');
  });
});

describe('mapFamilyScheduleRow', () => {
  it('maps a sanitized Busy-block row (nulled content, participant null)', () => {
    const row: RawFamilyScheduleRow = {
      id: 'e1',
      family_id: 'f1',
      owner_profile_id: 'p1',
      starts_at: '2026-09-15T17:00:00Z',
      ends_at: '2026-09-15T18:00:00Z',
      visibility: 'private',
      title: null,
      description: null,
      location: null,
      participant_member_id: null,
    };
    expect(mapFamilyScheduleRow(row)).toEqual({
      id: 'e1',
      familyId: 'f1',
      ownerProfileId: 'p1',
      startsAt: '2026-09-15T17:00:00Z',
      endsAt: '2026-09-15T18:00:00Z',
      visibility: 'private',
      title: null,
      description: null,
      location: null,
      participantMemberId: null,
    });
  });
});

describe('mapFamilyResponsibilityRow', () => {
  it('maps every column including the derived due_at/event fields', () => {
    const row: RawFamilyResponsibilityRow = {
      id: 'r1',
      event_id: 'e1',
      family_id: 'f1',
      type: 'pick_up',
      label: null,
      assignee_member_id: 'm1',
      status: 'pending_acceptance',
      event_starts_at: '2026-09-15T17:00:00Z',
      event_ends_at: '2026-09-15T18:00:00Z',
      event_title: 'Swimming',
      due_at: '2026-09-15T18:00:00Z',
    };
    expect(mapFamilyResponsibilityRow(row)).toEqual({
      id: 'r1',
      eventId: 'e1',
      familyId: 'f1',
      type: 'pick_up',
      label: null,
      assigneeMemberId: 'm1',
      status: 'pending_acceptance',
      eventStartsAt: '2026-09-15T17:00:00Z',
      eventEndsAt: '2026-09-15T18:00:00Z',
      eventTitle: 'Swimming',
      dueAt: '2026-09-15T18:00:00Z',
    });
  });
});
