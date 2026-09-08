import type { Tables } from '@/lib/supabase/types';

import { TASK_PRIORITIES, type TaskPriority } from './priority';
import type { AssignmentStatus, Task, TaskVisibility } from './types';

// CHECK-constrained columns come back as plain `string` from the generated
// types — narrowed here with a safe fallback, same convention as
// src/domain/profile/mappers.ts and src/domain/family/mappers.ts.
const TASK_VISIBILITIES: readonly TaskVisibility[] = ['private', 'family'];
const ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'unassigned',
  'pending_acceptance',
  'accepted',
  'declined',
];

function asPriority(value: string): TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value)
    ? (value as TaskPriority)
    : 'normal';
}

function asVisibility(value: string): TaskVisibility {
  return (TASK_VISIBILITIES as readonly string[]).includes(value)
    ? (value as TaskVisibility)
    : 'private';
}

function asAssignmentStatus(value: string): AssignmentStatus {
  return (ASSIGNMENT_STATUSES as readonly string[]).includes(value)
    ? (value as AssignmentStatus)
    : 'unassigned';
}

/**
 * Maps a `personal_task_occurrences` row (Phase 8) to the same `Task`
 * shape `mapTaskRow` produces, so every existing consumer (TaskRow,
 * sections.ts bucketing, etc.) keeps working unchanged for a recurring
 * occurrence too. `id` is the *occurrence*'s own id for a recurring row
 * (never the series' task id — see `Task.occurrenceId`'s own comment for
 * why); for a one-off task passed through the same view, occurrenceId is
 * null and id is the task id, identical to what mapTaskRow would produce.
 */
export function mapPersonalTaskOccurrenceRow(row: Tables<'personal_task_occurrences'>): Task {
  // Every column below is genuinely NOT NULL in the underlying view's own
  // query (see supabase/migrations/20260908120000_recurring_tasks_reminders.sql)
  // — Supabase's type generator marks all view columns nullable regardless
  // (views carry no constraints of their own), so the `??` fallbacks here
  // exist only to satisfy that generated type, not because these values
  // are ever actually expected to be missing.
  const occurrenceDate = row.occurrence_date ?? '';
  return {
    id: row.occurrence_id ?? row.task_id ?? '',
    ownerProfileId: row.owner_profile_id ?? '',
    familyId: row.family_id,
    title: row.title ?? '',
    description: row.description,
    date: occurrenceDate,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    timezone: row.timezone,
    priority: asPriority(row.priority ?? 'normal'),
    categoryId: row.category_id,
    visibility: asVisibility(row.visibility ?? 'private'),
    completedAt: row.completed_at,
    createdAt: row.completed_at ?? occurrenceDate, // occurrences have no created_at of their own
    updatedAt: row.completed_at ?? occurrenceDate,
    assigneeMemberId: null, // recurring personal tasks are never shared — see docs/DECISIONS.md, "Phase 8"
    assignmentStatus: 'unassigned',
    occurrenceId: row.occurrence_id,
    seriesTaskId: row.task_id ?? '',
    isRecurring: row.is_recurring ?? false,
    rescheduled: row.rescheduled ?? false,
  };
}

export function mapTaskRow(row: Tables<'tasks'>): Task {
  return {
    id: row.id,
    ownerProfileId: row.owner_profile_id,
    familyId: row.family_id,
    title: row.title,
    description: row.description,
    date: row.date,
    startTime: row.start_time,
    durationMinutes: row.duration_minutes,
    timezone: row.timezone,
    priority: asPriority(row.priority),
    categoryId: row.category_id,
    visibility: asVisibility(row.visibility),
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assigneeMemberId: row.assignee_member_id,
    assignmentStatus: asAssignmentStatus(row.assignment_status),
    recurrenceRuleId: row.recurrence_rule_id,
  };
}
