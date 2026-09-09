import { mapFamilyConflictRow, type RawFamilyConflictRow } from './mappers';

const BASE_ROW: RawFamilyConflictRow = {
  conflict_id: 'c1',
  family_id: 'f1',
  conflict_date: '2026-10-08',
  type: 'event_event',
  severity: 'warning',
  member_id: 'm1',
  primary_entity_type: 'event',
  primary_entity_id: 'e1',
  secondary_entity_type: 'event',
  secondary_entity_id: 'e2',
  safe_message_code: 'conflicts.event_event',
  safe_message_params: { time: '18:00' },
};

describe('mapFamilyConflictRow', () => {
  it('maps a row 1:1 for the normal case', () => {
    expect(mapFamilyConflictRow(BASE_ROW)).toEqual({
      conflictId: 'c1',
      familyId: 'f1',
      conflictDate: '2026-10-08',
      type: 'event_event',
      severity: 'warning',
      memberId: 'm1',
      primaryEntityType: 'event',
      primaryEntityId: 'e1',
      secondaryEntityType: 'event',
      secondaryEntityId: 'e2',
      safeMessageCode: 'conflicts.event_event',
      safeMessageParams: { time: '18:00' },
    });
  });

  it("never drops a redacted (null) entity id — the conflict itself must still render, just not navigate to someone else's private item", () => {
    const mapped = mapFamilyConflictRow({
      ...BASE_ROW,
      primary_entity_id: null,
      secondary_entity_type: null,
      secondary_entity_id: null,
    });
    expect(mapped.primaryEntityId).toBeNull();
    expect(mapped.secondaryEntityType).toBeNull();
    expect(mapped.secondaryEntityId).toBeNull();
    // The conflict record itself, and its safe message, survive intact.
    expect(mapped.conflictId).toBe('c1');
    expect(mapped.safeMessageCode).toBe('conflicts.event_event');
  });

  it('memberId is null for a conflict with no single responsible member (e.g. no_available_adult)', () => {
    expect(mapFamilyConflictRow({ ...BASE_ROW, member_id: null }).memberId).toBeNull();
  });

  it.each([
    'event_event',
    'task_event',
    'task_task',
    'responsibility_busy',
    'responsibility_responsibility',
    'unassigned_dropoff_pickup',
    'no_available_adult',
  ] as const)('accepts the real conflict type %s', (type) => {
    expect(mapFamilyConflictRow({ ...BASE_ROW, type }).type).toBe(type);
  });

  it('falls back safely to "task_task" for an unrecognized type value', () => {
    expect(mapFamilyConflictRow({ ...BASE_ROW, type: 'something_new' }).type).toBe('task_task');
  });

  it('falls back safely to "warning" for an unrecognized severity value', () => {
    expect(mapFamilyConflictRow({ ...BASE_ROW, severity: 'apocalyptic' }).severity).toBe('warning');
  });

  it('accepts the real "critical" severity', () => {
    expect(mapFamilyConflictRow({ ...BASE_ROW, severity: 'critical' }).severity).toBe('critical');
  });

  it('falls back safely to "task" for an unrecognized primary entity type', () => {
    expect(mapFamilyConflictRow({ ...BASE_ROW, primary_entity_type: 'something_new' }).primaryEntityType).toBe(
      'task',
    );
  });

  it('a null secondary entity type maps to null, not a fallback string', () => {
    expect(mapFamilyConflictRow({ ...BASE_ROW, secondary_entity_type: null }).secondaryEntityType).toBeNull();
  });

  it('drops any non-string value from safe_message_params, never crashing on unexpected shapes', () => {
    expect(
      mapFamilyConflictRow({ ...BASE_ROW, safe_message_params: { time: '18:00', extra: 42 } }).safeMessageParams,
    ).toEqual({ time: '18:00' });
    expect(mapFamilyConflictRow({ ...BASE_ROW, safe_message_params: null }).safeMessageParams).toEqual({});
    expect(mapFamilyConflictRow({ ...BASE_ROW, safe_message_params: 'not an object' }).safeMessageParams).toEqual(
      {},
    );
  });
});
