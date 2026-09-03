import { compareDateOnlyStrings } from './dateUtils';
import { comparePriorityDescending } from './priority';
import type { Task } from './types';

/**
 * Pure bucketing/sorting for a day's tasks — no I/O, no React, safe to unit
 * test directly (see docs/TEST_STRATEGY.md, "Today sorting"). The Today
 * screen composes buildTodaySections(); the Tomorrow screen (and any other
 * single-date view) uses buildDaySections() directly.
 */

export interface DaySections {
  /** Has a start_time, sorted earliest first. */
  timed: Task[];
  /** No start_time, sorted by priority (critical first), then creation order. */
  anytime: Task[];
  /** completedAt is set, most recently completed first. */
  completed: Task[];
}

function byCreatedAtAscending(a: Task, b: Task): number {
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? -1 : 1;
}

function byStartTimeAscending(a: Task, b: Task): number {
  const aTime = a.startTime ?? '';
  const bTime = b.startTime ?? '';
  if (aTime === bTime) return 0;
  return aTime < bTime ? -1 : 1;
}

function byCompletedAtDescending(a: Task, b: Task): number {
  const aAt = a.completedAt ?? '';
  const bAt = b.completedAt ?? '';
  if (aAt === bAt) return 0;
  return aAt > bAt ? -1 : 1;
}

export function buildDaySections(tasks: readonly Task[]): DaySections {
  const active = tasks.filter((task) => task.completedAt === null);
  const completed = tasks.filter((task) => task.completedAt !== null).sort(byCompletedAtDescending);

  const timed = active.filter((task) => task.startTime !== null).sort(byStartTimeAscending);

  const anytime = active
    .filter((task) => task.startTime === null)
    .sort((a, b) => comparePriorityDescending(a.priority, b.priority) || byCreatedAtAscending(a, b));

  return { timed, anytime, completed };
}

export interface TodaySections extends DaySections {
  /** date < today, not completed, sorted oldest-overdue first then by priority. */
  overdue: Task[];
}

/**
 * `overdueTasks` and `todayTasks` are separate query results (see
 * src/domain/tasks/hooks.ts) — kept separate rather than one big list so
 * each can be fetched/cached/invalidated independently.
 */
export function buildTodaySections(
  overdueTasks: readonly Task[],
  todayTasks: readonly Task[],
): TodaySections {
  const overdue = overdueTasks
    .filter((task) => task.completedAt === null)
    .sort(
      (a, b) =>
        compareDateOnlyStrings(a.date ?? '', b.date ?? '') ||
        comparePriorityDescending(a.priority, b.priority),
    );

  return { overdue, ...buildDaySections(todayTasks) };
}
