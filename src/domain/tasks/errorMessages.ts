import type { TaskErrorCode } from '@/lib/tasks/taskService';

/**
 * Maps TaskServiceError.code to a translation key under the `tasks`
 * namespace. See src/domain/family/errorMessages.ts for the established
 * pattern this mirrors.
 */
const TASK_ERROR_MESSAGE_KEYS: Record<TaskErrorCode, string> = {
  forbidden: 'errors.forbidden',
  invalid_input: 'errors.invalidInput',
  unknown: 'errors.generic',
};

export function taskErrorMessageKey(code: TaskErrorCode): string {
  return `tasks:${TASK_ERROR_MESSAGE_KEYS[code] ?? TASK_ERROR_MESSAGE_KEYS.unknown}`;
}
