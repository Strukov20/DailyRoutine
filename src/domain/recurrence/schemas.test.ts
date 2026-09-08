import { recurrenceEditorSchema, reminderEditorSchema } from './schemas';

describe('recurrenceEditorSchema', () => {
  const base = { frequency: 'daily' as const, interval: 1, endCondition: 'never' as const };

  it('accepts a minimal valid daily recurrence', () => {
    expect(recurrenceEditorSchema.safeParse(base).success).toBe(true);
  });

  it.each(['daily', 'weekly', 'monthly', 'yearly'])('accepts every supported frequency: %s', (frequency) => {
    const input =
      frequency === 'weekly'
        ? { ...base, frequency, byWeekday: [1, 3, 5] }
        : { ...base, frequency };
    expect(recurrenceEditorSchema.safeParse(input).success).toBe(true);
  });

  it('rejects weekly recurrence with no weekday selected', () => {
    const result = recurrenceEditorSchema.safeParse({ ...base, frequency: 'weekly', byWeekday: [] });
    expect(result.success).toBe(false);
  });

  it('accepts weekly recurrence with at least one weekday', () => {
    const result = recurrenceEditorSchema.safeParse({ ...base, frequency: 'weekly', byWeekday: [0] });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive interval', () => {
    expect(recurrenceEditorSchema.safeParse({ ...base, interval: 0 }).success).toBe(false);
    expect(recurrenceEditorSchema.safeParse({ ...base, interval: -1 }).success).toBe(false);
  });

  it('rejects an interval beyond the safe bound (365)', () => {
    expect(recurrenceEditorSchema.safeParse({ ...base, interval: 366 }).success).toBe(false);
  });

  it('requires an until date when endCondition is on_date', () => {
    expect(recurrenceEditorSchema.safeParse({ ...base, endCondition: 'on_date' }).success).toBe(false);
    expect(
      recurrenceEditorSchema.safeParse({ ...base, endCondition: 'on_date', until: '2026-12-01' }).success,
    ).toBe(true);
  });

  it('rejects a malformed until date', () => {
    expect(
      recurrenceEditorSchema.safeParse({ ...base, endCondition: 'on_date', until: 'not-a-date' }).success,
    ).toBe(false);
  });

  it('requires a count when endCondition is after_count', () => {
    expect(recurrenceEditorSchema.safeParse({ ...base, endCondition: 'after_count' }).success).toBe(false);
    expect(
      recurrenceEditorSchema.safeParse({ ...base, endCondition: 'after_count', count: 10 }).success,
    ).toBe(true);
  });

  it('rejects a count beyond the safe bound (1000)', () => {
    expect(
      recurrenceEditorSchema.safeParse({ ...base, endCondition: 'after_count', count: 1001 }).success,
    ).toBe(false);
  });

  it('never requires both until and count simultaneously (mutually exclusive by construction)', () => {
    // The schema itself only validates whichever endCondition is selected —
    // supplying both alongside "never" is simply ignored, never an error.
    const result = recurrenceEditorSchema.safeParse({ ...base, until: '2026-12-01', count: 5 });
    expect(result.success).toBe(true);
  });
});

describe('reminderEditorSchema', () => {
  it('accepts a relative reminder with an offset', () => {
    expect(reminderEditorSchema.safeParse({ kind: 'relative', offsetMinutesBefore: 15 }).success).toBe(true);
  });

  it('rejects a relative reminder with no offset', () => {
    expect(reminderEditorSchema.safeParse({ kind: 'relative' }).success).toBe(false);
  });

  it('accepts an absolute reminder with a remindAt instant', () => {
    expect(
      reminderEditorSchema.safeParse({ kind: 'absolute', remindAt: '2026-09-20T09:00:00.000Z' }).success,
    ).toBe(true);
  });

  it('rejects an absolute reminder with no remindAt', () => {
    expect(reminderEditorSchema.safeParse({ kind: 'absolute' }).success).toBe(false);
  });

  it('rejects a negative offset', () => {
    expect(reminderEditorSchema.safeParse({ kind: 'relative', offsetMinutesBefore: -1 }).success).toBe(false);
  });

  it('accepts an offset of exactly 0 ("at time")', () => {
    expect(reminderEditorSchema.safeParse({ kind: 'relative', offsetMinutesBefore: 0 }).success).toBe(true);
  });
});
