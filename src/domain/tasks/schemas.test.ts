import { quickAddTaskSchema, taskEditorSchema } from './schemas';

describe('quickAddTaskSchema', () => {
  it('accepts a non-blank title', () => {
    expect(quickAddTaskSchema.safeParse({ title: 'Buy milk' }).success).toBe(true);
  });

  it('rejects a blank or whitespace-only title', () => {
    expect(quickAddTaskSchema.safeParse({ title: '' }).success).toBe(false);
    expect(quickAddTaskSchema.safeParse({ title: '   ' }).success).toBe(false);
  });
});

describe('taskEditorSchema', () => {
  const base = { title: 'Task', priority: 'normal' as const, visibility: 'private' as const };

  it('accepts title-only (everything else optional)', () => {
    expect(taskEditorSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a date with no time (Anytime)', () => {
    expect(taskEditorSchema.safeParse({ ...base, date: '2026-09-03' }).success).toBe(true);
  });

  it('accepts a date with a time', () => {
    expect(
      taskEditorSchema.safeParse({ ...base, date: '2026-09-03', startTime: '09:00' }).success,
    ).toBe(true);
  });

  it('rejects a start time without a date ("time cannot silently exist without a date")', () => {
    const result = taskEditorSchema.safeParse({ ...base, startTime: '09:00' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('startTime'))).toBe(true);
    }
  });

  it('rejects a duration without a start time', () => {
    const result = taskEditorSchema.safeParse({ ...base, date: '2026-09-03', durationMinutes: 30 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('durationMinutes'))).toBe(
        true,
      );
    }
  });

  it('rejects a non-positive duration', () => {
    const result = taskEditorSchema.safeParse({
      ...base,
      date: '2026-09-03',
      startTime: '09:00',
      durationMinutes: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a duration over 1440 minutes', () => {
    const result = taskEditorSchema.safeParse({
      ...base,
      date: '2026-09-03',
      startTime: '09:00',
      durationMinutes: 1441,
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 1440 minutes (the boundary)', () => {
    const result = taskEditorSchema.safeParse({
      ...base,
      date: '2026-09-03',
      startTime: '09:00',
      durationMinutes: 1440,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a blank title', () => {
    expect(taskEditorSchema.safeParse({ ...base, title: '  ' }).success).toBe(false);
  });

  it('rejects an invalid priority or visibility value', () => {
    expect(taskEditorSchema.safeParse({ ...base, priority: 'urgent' }).success).toBe(false);
    expect(taskEditorSchema.safeParse({ ...base, visibility: 'public' }).success).toBe(false);
  });
});
