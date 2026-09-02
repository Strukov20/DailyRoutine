/**
 * Pure domain logic for task priority. No I/O, no React — safe to unit test
 * in isolation and safe to reuse from both client code and (later) any
 * server-side function that needs the same ordering.
 */
export const TASK_PRIORITIES = ['normal', 'important', 'critical'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  normal: 0,
  important: 1,
  critical: 2,
};

export function getPriorityWeight(priority: TaskPriority): number {
  return PRIORITY_WEIGHT[priority];
}

/** Sorts descending by priority (critical first), stable for equal priorities. */
export function comparePriorityDescending(a: TaskPriority, b: TaskPriority): number {
  return getPriorityWeight(b) - getPriorityWeight(a);
}

export function isHigherPriority(a: TaskPriority, b: TaskPriority): boolean {
  return getPriorityWeight(a) > getPriorityWeight(b);
}
