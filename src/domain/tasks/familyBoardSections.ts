import type { Task } from './types';

/**
 * Pure bucketing for the family task board (Phase 5) — mirrors
 * sections.ts's separation of concerns (no I/O, no React). Every task
 * appears in exactly one section, chosen by priority order (completed
 * first, then "needs me," then "mine," then everyone else's), so nothing
 * is double-counted between sections.
 */
export interface FamilyBoardSections {
  /** Pending acceptance/decline for the current user specifically. */
  awaitingMyResponse: Task[];
  /** Created by the current user, or accepted-assigned to them. */
  myFamilyTasks: Task[];
  /** Unassigned, and not created by the current user (those are in myFamilyTasks). */
  unassigned: Task[];
  /** Assigned to (or pending on) someone else entirely. */
  assignedToOthers: Task[];
  completed: Task[];
}

export function buildFamilyBoardSections(
  tasks: readonly Task[],
  profileId: string,
  myMemberId: string | null,
): FamilyBoardSections {
  const isMyAssignment = (task: Task) =>
    myMemberId !== null && task.assigneeMemberId === myMemberId;

  const active = tasks.filter((task) => task.completedAt === null);
  const completed = tasks.filter((task) => task.completedAt !== null);

  const awaitingMyResponse = active.filter(
    (task) => isMyAssignment(task) && task.assignmentStatus === 'pending_acceptance',
  );

  const myFamilyTasks = active.filter(
    (task) =>
      !awaitingMyResponse.includes(task) &&
      (task.ownerProfileId === profileId ||
        (isMyAssignment(task) && task.assignmentStatus === 'accepted')),
  );

  const unassigned = active.filter(
    (task) =>
      !awaitingMyResponse.includes(task) &&
      !myFamilyTasks.includes(task) &&
      task.assignmentStatus === 'unassigned',
  );

  const assignedToOthers = active.filter(
    (task) =>
      !awaitingMyResponse.includes(task) &&
      !myFamilyTasks.includes(task) &&
      !unassigned.includes(task),
  );

  return { awaitingMyResponse, myFamilyTasks, unassigned, assignedToOthers, completed };
}
