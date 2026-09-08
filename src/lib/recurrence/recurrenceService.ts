import { supabase } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger/logger';
import { mapPersonalTaskOccurrenceRow } from '@/domain/tasks/mappers';
import type { Task } from '@/domain/tasks/types';
import type {
  CreateRecurringTaskParams,
  RescheduleOccurrenceParams,
  TaskReminder,
  UpdateRecurringSeriesParams,
} from '@/domain/recurrence/types';

const logger = createLogger('recurrence-service');

/**
 * Transport-layer wrapper around the recurring-task/occurrence/reminder
 * RPCs — the only module that calls any of them. Mirrors
 * src/lib/tasks/taskService.ts / src/lib/calendar/calendarService.ts. Every
 * mutation is a narrowly scoped SECURITY DEFINER RPC (see
 * supabase/migrations/20260908120000_recurring_tasks_reminders.sql) —
 * task_occurrences/reminders/recurrence_rules have no direct write grant at
 * all for `authenticated`.
 */

export type RecurrenceErrorCode = 'forbidden' | 'invalid_input' | 'unknown';

const CODE_BY_SQLSTATE: Record<string, RecurrenceErrorCode> = {
  '42501': 'forbidden',
  '22023': 'invalid_input',
};

export class RecurrenceServiceError extends Error {
  readonly code: RecurrenceErrorCode;

  constructor(code: RecurrenceErrorCode, message: string) {
    super(message);
    this.name = 'RecurrenceServiceError';
    this.code = code;
  }
}

function toRecurrenceServiceError(error: unknown): RecurrenceServiceError {
  const sqlState = (error as { code?: string } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : 'Unknown recurrence error';
  logger.warn('recurrence request failed', { sqlState, message });
  const normalized = (sqlState && CODE_BY_SQLSTATE[sqlState]) || 'unknown';
  return new RecurrenceServiceError(normalized, message);
}

export async function createRecurringTask(params: CreateRecurringTaskParams): Promise<string> {
  const { data, error } = await supabase.rpc('create_recurring_personal_task', {
    p_title: params.title,
    p_date: params.date,
    p_timezone: params.timezone,
    p_frequency: params.frequency,
    p_start_time: params.startTime,
    p_duration_minutes: params.durationMinutes,
    p_interval: params.interval,
    p_by_weekday: params.byWeekday,
    p_until: params.until,
    p_count: params.count,
    p_description: params.description,
    p_priority: params.priority,
    p_category_id: params.categoryId,
  });
  if (error) throw toRecurrenceServiceError(error);
  return data;
}

export async function updateRecurringSeries(params: UpdateRecurringSeriesParams): Promise<void> {
  const { error } = await supabase.rpc('update_recurring_series', {
    p_task_id: params.taskId,
    p_title: params.title,
    p_description: params.description,
    p_clear_description: params.clearDescription,
    p_priority: params.priority,
    p_category_id: params.categoryId,
    p_clear_category: params.clearCategory,
    p_start_time: params.startTime,
    p_clear_start_time: params.clearStartTime,
    p_duration_minutes: params.durationMinutes,
    p_frequency: params.frequency,
    p_interval: params.interval,
    p_by_weekday: params.byWeekday,
    p_until: params.until,
    p_clear_until: params.clearUntil,
    p_count: params.count,
    p_clear_count: params.clearCount,
  });
  if (error) throw toRecurrenceServiceError(error);
  await ensureOccurrencesGenerated();
}

export async function stopRecurringSeries(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('stop_recurring_series', { p_task_id: taskId });
  if (error) throw toRecurrenceServiceError(error);
}

export async function ensureOccurrencesGenerated(throughDate?: string): Promise<void> {
  const { error } = await supabase.rpc('generate_task_occurrences', {
    p_through_date: throughDate,
  });
  if (error) throw toRecurrenceServiceError(error);
}

export async function completeOccurrence(occurrenceId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_task_occurrence', { p_occurrence_id: occurrenceId });
  if (error) throw toRecurrenceServiceError(error);
}

export async function restoreOccurrence(occurrenceId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_task_occurrence', { p_occurrence_id: occurrenceId });
  if (error) throw toRecurrenceServiceError(error);
}

export async function skipOccurrence(occurrenceId: string): Promise<void> {
  const { error } = await supabase.rpc('skip_task_occurrence', { p_occurrence_id: occurrenceId });
  if (error) throw toRecurrenceServiceError(error);
}

export async function rescheduleOccurrence(params: RescheduleOccurrenceParams): Promise<void> {
  const { error } = await supabase.rpc('reschedule_task_occurrence', {
    p_occurrence_id: params.occurrenceId,
    p_date: params.date,
    p_start_time: params.startTime,
    p_duration_minutes: params.durationMinutes,
    p_clear_start_time: params.clearStartTime,
  });
  if (error) throw toRecurrenceServiceError(error);
}

function mapReminderRow(row: {
  id: string;
  task_id: string;
  profile_id: string;
  remind_at: string | null;
  offset_minutes_before: number | null;
  occurrence_id: string | null;
  is_snooze: boolean;
  label: string | null;
  created_at: string;
}): TaskReminder {
  return {
    id: row.id,
    taskId: row.task_id,
    profileId: row.profile_id,
    remindAt: row.remind_at,
    offsetMinutesBefore: row.offset_minutes_before,
    occurrenceId: row.occurrence_id,
    isSnooze: row.is_snooze,
    label: row.label,
    createdAt: row.created_at,
  };
}

/** Standing reminder definitions for a task (excludes one-time snooze reminders). */
export async function listTaskReminders(taskId: string): Promise<TaskReminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('task_id', taskId)
    .eq('is_snooze', false)
    .order('created_at', { ascending: true });
  if (error) throw toRecurrenceServiceError(error);
  return data.map(mapReminderRow);
}

export async function createTaskReminder(params: {
  taskId: string;
  offsetMinutesBefore?: number;
  remindAt?: string;
  label?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_task_reminder', {
    p_task_id: params.taskId,
    p_offset_minutes_before: params.offsetMinutesBefore,
    p_remind_at: params.remindAt,
    p_label: params.label,
  });
  if (error) throw toRecurrenceServiceError(error);
  return data;
}

export async function deleteTaskReminder(reminderId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_task_reminder', { p_reminder_id: reminderId });
  if (error) throw toRecurrenceServiceError(error);
}

export async function snoozeOccurrence(params: {
  taskId: string;
  occurrenceId?: string;
  minutes?: number;
  until?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('snooze_task_occurrence', {
    p_task_id: params.taskId,
    p_occurrence_id: params.occurrenceId,
    p_minutes: params.minutes,
    p_until: params.until,
  });
  if (error) throw toRecurrenceServiceError(error);
  return data;
}

/** All of the caller's pending (undelivered) reminders, both standing and snooze — the local scheduler's own source of truth for what *should* be scheduled. */
export async function listAllPendingReminders(profileId: string): Promise<TaskReminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('profile_id', profileId);
  if (error) throw toRecurrenceServiceError(error);
  return data.map(mapReminderRow);
}

/** All of the caller's currently-scheduled (not completed/skipped) occurrences, for the local scheduler to compute concrete reminder instants against. */
export async function listAllScheduledOccurrences(profileId: string): Promise<Task[]> {
  await ensureOccurrencesGenerated();
  const { data, error } = await supabase
    .from('personal_task_occurrences')
    .select('*')
    .eq('owner_profile_id', profileId)
    .eq('status', 'scheduled');
  if (error) throw toRecurrenceServiceError(error);
  return data.map(mapPersonalTaskOccurrenceRow);
}
