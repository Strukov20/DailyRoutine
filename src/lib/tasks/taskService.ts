import { supabase } from '@/lib/supabase/client';
import { createLogger } from '@/lib/logger/logger';
import { mapPersonalTaskOccurrenceRow, mapTaskRow } from '@/domain/tasks/mappers';
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

export type TaskErrorCode = 'forbidden' | 'not_found' | 'invalid_input' | 'conflict' | 'unknown';

const CODE_BY_SQLSTATE: Record<string, TaskErrorCode> = {
  '42501': 'forbidden',
  '22023': 'invalid_input',
  '23514': 'invalid_input',
  // The assignment state machine's RPCs (Phase 5) raise 40001 for a stale/
  // already-resolved state — someone else took the task, a reassigned-away
  // recipient tried to accept, etc. See docs/DECISIONS.md, "Phase 5."
  '40001': 'conflict',
  // Sync Issues completion pass (Phase 9) — update/schedule/complete/
  // restore_personal_task now distinguish "the row is gone" (P0002) from
  // "the row exists but isn't yours" (42501), so an offline replay against
  // a task deleted from another device can show "This task no longer
  // exists" instead of the generic authorization message. See
  // docs/DECISIONS.md, "Phase 9."
  P0002: 'not_found',
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
 * which is correct for the family board (see listFamilyTasks) but wrong
 * here, where only "my own tasks" belong. listTasksForDate/listOverdueTasks
 * additionally include tasks *assigned to and accepted by* the caller
 * (Phase 5, "accepted family tasks appear in Today/Tomorrow when
 * scheduled") — Inbox deliberately does not, since an unscheduled assigned
 * task belongs on the family board's "My family tasks" section, not mixed
 * into a personal date-less list. A merely *pending* assignment never
 * qualifies either way (see src/domain/tasks/hooks.ts's "awaiting response"
 * query) — only 'accepted' counts as this user's own work.
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

/** The caller's own (non-removed) family_members.id across every family they belong to. */
async function listMyMemberIds(profileId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('id')
    .eq('profile_id', profileId)
    .is('removed_at', null);
  if (error) throw toTaskServiceError(error);
  return data.map((row) => row.id);
}

/** "owner, OR an accepted assignee via one of these member ids" as a PostgREST .or() filter. */
function ownerOrAcceptedAssigneeFilter(profileId: string, memberIds: string[]): string {
  if (memberIds.length === 0) return `owner_profile_id.eq.${profileId}`;
  const idList = memberIds.join(',');
  return `owner_profile_id.eq.${profileId},and(assignee_member_id.in.(${idList}),assignment_status.eq.accepted)`;
}

/**
 * Extends the caller's recurring-task occurrences up to the 45-day rolling
 * horizon (server-clamped regardless of what's asked for) — call before any
 * read that needs recurring occurrences populated. Idempotent, cheap on a
 * cache hit (see docs/DECISIONS.md, "Phase 8"). `p_through_date` is a plain
 * ISO date string ("YYYY-MM-DD"), not a Date, matching this module's
 * existing date-only convention.
 */
export async function ensureOccurrencesGenerated(throughDate?: string): Promise<void> {
  const { error } = await supabase.rpc('generate_task_occurrences', {
    p_through_date: throughDate ?? undefined,
  });
  if (error) throw toTaskServiceError(error);
}

async function listOccurrencesForDate(profileId: string, date: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('personal_task_occurrences')
    .select('*')
    .eq('occurrence_date', date)
    .eq('owner_profile_id', profileId)
    .eq('is_recurring', true)
    .neq('status', 'skipped');
  if (error) throw toTaskServiceError(error);
  return data.map(mapPersonalTaskOccurrenceRow);
}

async function listOverdueOccurrences(profileId: string, beforeDate: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('personal_task_occurrences')
    .select('*')
    .lt('occurrence_date', beforeDate)
    .eq('owner_profile_id', profileId)
    .eq('is_recurring', true)
    .eq('status', 'scheduled');
  if (error) throw toTaskServiceError(error);
  return data.map(mapPersonalTaskOccurrenceRow);
}

/**
 * Today/Tomorrow's own date-scoped read — a one-off task or an accepted
 * shared-task assignment comes straight from `tasks` exactly as before
 * Phase 8 (recurring tasks are always personal, never shared, so this
 * assignee-inclusive query is unaffected by excluding them); a recurring
 * personal task's occurrence for this date comes from
 * `personal_task_occurrences` instead — never both, since
 * `recurrence_rule_id is not null` is excluded from the direct query.
 */
export async function listTasksForDate(profileId: string, date: string): Promise<Task[]> {
  await ensureOccurrencesGenerated(date);
  const memberIds = await listMyMemberIds(profileId);
  const [{ data, error }, occurrences] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('date', date)
      .is('recurrence_rule_id', null)
      .or(ownerOrAcceptedAssigneeFilter(profileId, memberIds)),
    listOccurrencesForDate(profileId, date),
  ]);
  if (error) throw toTaskServiceError(error);
  return [...data.map(mapTaskRow), ...occurrences];
}

/** Active (not completed) tasks/occurrences dated strictly before `beforeDate`. */
export async function listOverdueTasks(profileId: string, beforeDate: string): Promise<Task[]> {
  await ensureOccurrencesGenerated();
  const memberIds = await listMyMemberIds(profileId);
  const [{ data, error }, occurrences] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .lt('date', beforeDate)
      .is('completed_at', null)
      .is('recurrence_rule_id', null)
      .or(ownerOrAcceptedAssigneeFilter(profileId, memberIds)),
    listOverdueOccurrences(profileId, beforeDate),
  ]);
  if (error) throw toTaskServiceError(error);
  return [...data.map(mapTaskRow), ...occurrences];
}

/**
 * Shared tasks pending the caller's own response ("Awaiting your
 * response") — across every family, regardless of date/Inbox status. Used
 * both by the Family board's own section and by a lightweight
 * app-wide pending-count badge.
 */
export async function listPendingAssignments(profileId: string): Promise<Task[]> {
  const memberIds = await listMyMemberIds(profileId);
  if (memberIds.length === 0) return [];
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .in('assignee_member_id', memberIds)
    .eq('assignment_status', 'pending_acceptance');
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
  /**
   * Phase 9 — an offline-queued create's idempotency key (see
   * src/lib/offline). `create_personal_task` returns the existing row's id
   * on a replay with the same (caller, clientOperationId) pair instead of
   * inserting a duplicate. Omitted for a normal online create.
   */
  clientOperationId?: string;
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
    p_client_operation_id: params.clientOperationId,
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
  /**
   * Phase 9 — optimistic-concurrency precondition (see docs/DECISIONS.md,
   * "Phase 9"): when set, the RPC raises a stale-write conflict (errcode
   * 40001, surfaced here as TaskErrorCode 'conflict') if the row's actual
   * updated_at no longer matches, rather than silently overwriting a
   * change made elsewhere. Omitted for a normal online edit, where the UI
   * already reflects the live server state.
   */
  expectedUpdatedAt?: string;
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
    p_expected_updated_at: params.expectedUpdatedAt,
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
  /** Phase 9 — same stale-write precondition as UpdatePersonalTaskParams.expectedUpdatedAt. */
  expectedUpdatedAt?: string;
}

export async function schedulePersonalTask(params: SchedulePersonalTaskParams): Promise<void> {
  const { error } = await supabase.rpc('schedule_personal_task', {
    p_task_id: params.taskId,
    p_date: params.date,
    p_start_time: params.startTime,
    p_duration_minutes: params.durationMinutes,
    p_timezone: params.timezone,
    p_expected_updated_at: params.expectedUpdatedAt,
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

/**
 * Every visibility='family' task in familyId — queried directly against
 * `tasks`, not the sanitized `family_task_board` view. A family-visible
 * task already shows full content to any current family member via the
 * base table's own RLS policy; the sanitized view exists for the *Busy-
 * block* case (a private task's mere existence + owner/time, not its
 * content) and isn't needed here since this query never includes private
 * tasks at all (RLS also naturally excludes both deleted tasks and any
 * family the caller isn't currently a member of).
 */
export async function listFamilyTasks(familyId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('family_id', familyId)
    .eq('visibility', 'family');
  if (error) throw toTaskServiceError(error);
  return data.map(mapTaskRow);
}

export interface CreateSharedFamilyTaskParams {
  familyId: string;
  title: string;
  description?: string;
  date?: string;
  startTime?: string;
  durationMinutes?: number;
  timezone?: string;
  priority?: TaskPriority;
  categoryId?: string;
  assigneeMemberId?: string;
}

export async function createSharedFamilyTask(
  params: CreateSharedFamilyTaskParams,
): Promise<string> {
  const { data, error } = await supabase.rpc('create_shared_family_task', {
    p_family_id: params.familyId,
    p_title: params.title,
    p_description: params.description,
    p_date: params.date,
    p_start_time: params.startTime,
    p_duration_minutes: params.durationMinutes,
    p_timezone: params.timezone,
    p_priority: params.priority,
    p_category_id: params.categoryId,
    p_assignee_member_id: params.assigneeMemberId,
  });
  if (error) throw toTaskServiceError(error);
  return data;
}

export async function assignFamilyTask(taskId: string, assigneeMemberId: string): Promise<void> {
  const { error } = await supabase.rpc('assign_family_task', {
    p_task_id: taskId,
    p_assignee_member_id: assigneeMemberId,
  });
  if (error) throw toTaskServiceError(error);
}

export async function reassignFamilyTask(taskId: string, assigneeMemberId: string): Promise<void> {
  const { error } = await supabase.rpc('reassign_family_task', {
    p_task_id: taskId,
    p_assignee_member_id: assigneeMemberId,
  });
  if (error) throw toTaskServiceError(error);
}

export async function unassignFamilyTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('unassign_family_task', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}

export async function takeFamilyTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('take_family_task', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}

export async function acceptTaskAssignment(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_task_assignment', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}

export async function declineTaskAssignment(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('decline_task_assignment', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}

export async function completeSharedTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_shared_task', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}

export async function restoreSharedTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_shared_task', { p_task_id: taskId });
  if (error) throw toTaskServiceError(error);
}
