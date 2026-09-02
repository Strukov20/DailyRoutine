import { supabase } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger/logger';
import { mapTaskRow } from '@/domain/tasks/mappers';
import type { Task, TaskVisibility } from '@/domain/tasks/types';
import type { TaskPriority } from '@/domain/tasks/priority';

const logger = createLogger('task-service');

/**
 * Transport-layer wrapper around the personal-task RPCs and their
 * supporting reads — the only place in the app that calls
 * `supabase.rpc(...)` or `supabase.from('tasks' | 'categories')` directly.
 * Screens go through src/domain/tasks/hooks.ts, which goes through this
 * module. See src/lib/family/familyService.ts for the established pattern
 * this mirrors, and docs/ARCHITECTURE.md for the layering rule.
 *
 * Every mutation here is a narrowly scoped SECURITY DEFINER RPC — see
 * supabase/migrations/20260904120000_personal_task_management.sql —
 * never a raw table INSERT/UPDATE/DELETE, because `tasks` intentionally
 * has no such grant for `authenticated`.
 */

export type TaskErrorCode = 'forbidden' | 'invalid_input' | 'unknown';

const CODE_BY_SQLSTATE: Record<string, TaskErrorCode> = {
  '42501': 'forbidden',
  '22023': 'invalid_input',
  '23514': 'invalid_input',
};

export class TaskServiceError extends Error {
  readonly code: TaskErrorCode;

  constructor(code: TaskErrorCode, message: string) {
    super(message);
    this.name = 'TaskServiceError';
    this.code = code;
  }
}

function toTaskServiceError(error: unknown): TaskServiceError {
  const sqlState = (error as { code?: string } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : 'Unknown task error';
  logger.warn('task request failed', { sqlState, message });
  const normalized = (sqlState && CODE_BY_SQLSTATE[sqlState]) || 'unknown';
  return new TaskServiceError(normalized, message);
}

/**
 * Every list function below explicitly filters `owner_profile_id` — RLS
 * alone would also let a family-visible task belonging to *another* family
 * member through (its SELECT policy is `owner OR family-visible member`),
 * which is correct for a future family board but wrong for a personal
 * Inbox/Today/Tomorrow view. This phase has no shared task board UI (see
 * docs/MVP_SCOPE.md), so every query here is scoped to "my own tasks."
 */

export async function listInboxTasks(profileId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('owner_profile_id', profileId)
    .is('date', null)
    .order('created_at', { ascending: false });
  if (error) throw toTaskServiceError(error);
  return data.map(mapTaskRow);
}

export async function listTasksForDate(profileId: string, date: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('owner_profile_id', profileId)
    .eq('date', date);
  if (error) throw toTaskServiceError(error);
  return data.map(mapTaskRow);
}

/** Active (not completed) tasks dated strictly before `beforeDate`. */
export async function listOverdueTasks(profileId: string, beforeDate: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('owner_profile_id', profileId)
    .lt('date', beforeDate)
    .is('completed_at', null);
  if (error) throw toTaskServiceError(error);
  return data.map(mapTaskRow);
}

export interface CreatePersonalTaskParams {
  title: string;
  description?: string;
  date?: string;
  startTime?: string;
  durationMinutes?: number;
  timezone?: string;
  priority?: TaskPriority;
  categoryId?: string;
  visibility?: TaskVisibility;
  familyId?: string;
}

export async function getTask(taskId: string): Promise<Task | null> {
  const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (error) throw toTaskServiceError(error);
  return data ? mapTaskRow(data) : null;
}

export async function createPersonalTask(params: CreatePersonalTaskParams): Promise<string> {
  const { data, error } = await supabase.rpc('create_personal_task', {
    p_title: params.title,
    p_description: params.description,
    p_date: params.date,
    p_start_time: params.startTime,
    p_duration_minutes: params.durationMinutes,
    p_timezone: params.timezone,
    p_priority: params.priority,
    p_category_id: params.categoryId,
    p_visibility: params.visibility,
    p_family_id: params.familyId,
  });
  if (error) throw toTaskServiceError(error);
  return data;
}

export interface UpdatePersonalTaskParams {
  taskId: string;
  title?: string;
  description?: string;
  clearDescription?: boolean;
  priority?: TaskPriority;
  categoryId?: string;
  clearCategory?: boolean;
  visibility?: TaskVisibility;
  familyId?: string;
}

export async function updatePersonalTask(params: UpdatePersonalTaskParams): Promise<void> {
  const { error } = await supabase.rpc('update_personal_task', {
    p_task_id: params.taskId,
    p_title: params.title,
    p_description: params.description,
    p_clear_description: params.clearDescription,
    p_priority: params.priority,
    p_category_id: params.categoryId,
    p_clear_category: params.clearCategory,
    p_visibility: params.visibility,
    p_family_id: params.familyId,
  });
  if (error) throw toTaskServiceError(error);
}

export async function completePersonalTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_personal_task', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}

export async function restorePersonalTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_personal_task', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}

export interface SchedulePersonalTaskParams {
  taskId: string;
  date: string;
  startTime?: string;
  durationMinutes?: number;
  timezone?: string;
}

export async function schedulePersonalTask(params: SchedulePersonalTaskParams): Promise<void> {
  const { error } = await supabase.rpc('schedule_personal_task', {
    p_task_id: params.taskId,
    p_date: params.date,
    p_start_time: params.startTime,
    p_duration_minutes: params.durationMinutes,
    p_timezone: params.timezone,
  });
  if (error) throw toTaskServiceError(error);
}

export async function moveTaskToInbox(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('move_task_to_inbox', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}

export async function deleteOrArchivePersonalTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_or_archive_personal_task', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}
