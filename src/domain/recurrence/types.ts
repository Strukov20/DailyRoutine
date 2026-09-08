/**
 * Domain shapes for recurring personal tasks and reminders (Phase 8).
 * Occurrences themselves are represented as ordinary `Task` objects (see
 * `src/domain/tasks/types.ts`'s `occurrenceId`/`isRecurring`/`rescheduled`
 * fields) — this module covers the recurrence *rule* and *reminder
 * definitions*, which have no equivalent in the pre-Phase-8 domain.
 */

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  /** 0 (Sunday) – 6 (Saturday), Postgres `extract(dow from ...)` convention. Required (non-empty) for weekly. */
  byWeekday: number[] | null;
  /** ISO date, or null. Mutually exclusive with `count`. */
  until: string | null;
  /** Mutually exclusive with `until`. */
  count: number | null;
  timezone: string;
  stoppedAt: string | null;
}

export interface CreateRecurringTaskParams {
  title: string;
  date: string;
  timezone: string;
  frequency: RecurrenceFrequency;
  startTime?: string;
  durationMinutes?: number;
  interval?: number;
  byWeekday?: number[];
  until?: string;
  count?: number;
  description?: string;
  priority?: string;
  categoryId?: string;
}

export interface UpdateRecurringSeriesParams {
  taskId: string;
  title?: string;
  description?: string;
  clearDescription?: boolean;
  priority?: string;
  categoryId?: string;
  clearCategory?: boolean;
  startTime?: string;
  clearStartTime?: boolean;
  durationMinutes?: number;
  frequency?: RecurrenceFrequency;
  interval?: number;
  byWeekday?: number[];
  until?: string;
  clearUntil?: boolean;
  count?: number;
  clearCount?: boolean;
}

export interface RescheduleOccurrenceParams {
  occurrenceId: string;
  date: string;
  startTime?: string;
  durationMinutes?: number;
  clearStartTime?: boolean;
}

export type ReminderTimeKind = 'relative' | 'absolute';

export interface TaskReminder {
  id: string;
  taskId: string;
  profileId: string;
  /** Null for a relative reminder — the concrete time is computed client-side per occurrence. */
  remindAt: string | null;
  /** Null for an absolute reminder. */
  offsetMinutesBefore: number | null;
  occurrenceId: string | null;
  isSnooze: boolean;
  label: string | null;
  createdAt: string;
}

/** The fixed presets the brief requires (Section 1) — "Custom" is any other non-negative offset. */
export const REMINDER_OFFSET_PRESETS = [0, 5, 15, 30, 60, 1440] as const;
