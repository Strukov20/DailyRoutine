import { eventEditorSchema } from './schemas';

describe('eventEditorSchema', () => {
  const basePersonal = {
    kind: 'personal' as const,
    title: 'Dentist',
    date: '2026-09-15',
    startTime: '09:00',
    endTime: '10:00',
    visibility: 'private' as const,
  };

  it('accepts a valid personal event', () => {
    expect(eventEditorSchema.safeParse(basePersonal).success).toBe(true);
  });

  it('rejects a missing title', () => {
    const result = eventEditorSchema.safeParse({ ...basePersonal, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an end time not after the start time', () => {
    const result = eventEditorSchema.safeParse({ ...basePersonal, startTime: '10:00', endTime: '09:00' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['endTime']);
    }
  });

  it('rejects an end time equal to the start time', () => {
    const result = eventEditorSchema.safeParse({ ...basePersonal, startTime: '09:00', endTime: '09:00' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid date/time format', () => {
    expect(eventEditorSchema.safeParse({ ...basePersonal, date: '15-09-2026' }).success).toBe(false);
    expect(eventEditorSchema.safeParse({ ...basePersonal, startTime: '9:00' }).success).toBe(false);
  });

  it('requires familyId for a family-kind event', () => {
    const result = eventEditorSchema.safeParse({ ...basePersonal, kind: 'family', familyId: undefined });
    expect(result.success).toBe(false);
  });

  it('accepts a family-kind event with familyId set', () => {
    const result = eventEditorSchema.safeParse({ ...basePersonal, kind: 'family', familyId: 'family-1' });
    expect(result.success).toBe(true);
  });

  it('requires both familyId and childMemberId for a child-kind event', () => {
    expect(eventEditorSchema.safeParse({ ...basePersonal, kind: 'child', familyId: 'family-1' }).success).toBe(
      false,
    );
    expect(
      eventEditorSchema.safeParse({
        ...basePersonal,
        kind: 'child',
        familyId: 'family-1',
        childMemberId: 'child-1',
      }).success,
    ).toBe(true);
  });

  it('does not require familyId for a personal event', () => {
    expect(eventEditorSchema.safeParse({ ...basePersonal, familyId: undefined }).success).toBe(true);
  });
});
