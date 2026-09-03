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
  };
}
