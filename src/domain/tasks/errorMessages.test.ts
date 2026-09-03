import type { TaskErrorCode } from '@/lib/tasks/taskService';

import { taskErrorMessageKey } from './errorMessages';

const ALL_CODES: TaskErrorCode[] = ['forbidden', 'invalid_input', 'unknown'];

describe('taskErrorMessageKey', () => {
  it('maps every TaskErrorCode to a distinct tasks: translation key', () => {
    const keys = ALL_CODES.map(taskErrorMessageKey);
    for (const key of keys) {
      expect(key).toMatch(/^tasks:errors\./);
    }
    expect(new Set(keys).size).toBe(ALL_CODES.length);
  });

  it('falls back to the generic key for an unrecognized code', () => {
    // @ts-expect-error deliberately passing an invalid code to prove the fallback
    expect(taskErrorMessageKey('not_a_real_code')).toBe('tasks:errors.generic');
  });
});
