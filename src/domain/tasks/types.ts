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

  /**
   * Set on a recurring series' own `tasks` row (never on an occurrence —
   * see `occurrenceId` below). `recurrence_rules` itself has no direct
   * client SELECT grant at all (locked down since Phase 2), so this is
   * only ever a presence signal ("this task is a recurring series' own
   * template row") — never a source of the rule's actual frequency/
   * interval/etc., which the client never reads back after creation (see
   * docs/DECISIONS.md, "Phase 8," for why the edit UI doesn't re-populate
   * those fields).
   */
  recurrenceRuleId?: string | null;

  /**
   * Phase 8 — set only when this row represents one occurrence of a
   * recurring series (from `personal_task_occurrences`, never from a plain
   * `tasks` row). When set, `id` is the *occurrence*'s own id (not the
   * series' task id — see `seriesTaskId`) so two occurrences of the same
   * series never collide as list keys, and every completion/reschedule/
   * skip action must go through the `*_task_occurrence` RPCs
   * (src/lib/recurrence/recurrenceService.ts), never
   * complete_personal_task/schedule_personal_task (the server rejects
   * those for a recurring series — see docs/DECISIONS.md, "Phase 8").
   */
  occurrenceId?: string | null;
  /** The underlying series' own task id — always present when occurrenceId is set. */
  seriesTaskId?: string;
  isRecurring?: boolean;
  /** True once this occurrence's date/time was individually moved away from the series' own pattern. */
  rescheduled?: boolean;
}
