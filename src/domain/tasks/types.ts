import type { TaskPriority } from './priority';

/**
 * Domain shape for a personal task — decoupled from the generated Supabase
 * row shape, same convention as src/domain/family/types.ts. `date` and
 * `startTime` stay as their raw Postgres string representations
 * ("YYYY-MM-DD" / "HH:MM:SS") rather than being parsed into a `Date` here —
 * see src/domain/tasks/dateUtils.ts for why: a date-only value must never
 * round-trip through a UTC-aware `Date` object at all.
 */
export type TaskVisibility = 'private' | 'family';

/**
 * The assignment state machine (Phase 5) — see docs/DECISIONS.md, "Phase 5"
 * for the full diagram. `unassigned` is also the value for every personal
 * (non-shared) task, which never has an assignee.
 */
export type AssignmentStatus = 'unassigned' | 'pending_acceptance' | 'accepted' | 'declined';

export interface Task {
  id: string;
  ownerProfileId: string;
  familyId: string | null;
  title: string;
  description: string | null;
  /** "YYYY-MM-DD", or null for an Inbox task. */
  date: string | null;
  /** "HH:MM:SS", or null for an Anytime (date-only) task. */
  startTime: string | null;
  durationMinutes: number | null;
  /** IANA zone captured when startTime was set; null whenever startTime is null. */
  timezone: string | null;
  priority: TaskPriority;
  categoryId: string | null;
  visibility: TaskVisibility;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** family_members.id of the current assignee — only ever set on a shared (family) task. */
  assigneeMemberId: string | null;
  assignmentStatus: AssignmentStatus;
}
