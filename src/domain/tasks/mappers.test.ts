import type { Tables } from '@/lib/supabase/types';

import { mapTaskRow } from './mappers';

const BASE_ROW: Tables<'tasks'> = {
  id: 't1',
  owner_profile_id: 'u1',
  family_id: null,
  title: 'Buy milk',
  description: null,
  date: null,
  start_time: null,
  duration_minutes: null,
  timezone: null,
  priority: 'normal',
  category_id: null,
  recurrence_rule_id: null,
  client_operation_id: null,
  visibility: 'private',
  completed_at: null,
  assignee_member_id: null,
  assignment_status: 'unassigned',
  deleted_at: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  created_by: 'u1',
};

describe('mapTaskRow', () => {
  it('maps a row 1:1 for the normal (personal, unassigned) case', () => {
    expect(mapTaskRow(BASE_ROW)).toEqual({
      id: 't1',
      ownerProfileId: 'u1',
      familyId: null,
      title: 'Buy milk',
      description: null,
      date: null,
      startTime: null,
      durationMinutes: null,
      timezone: null,
      priority: 'normal',
      categoryId: null,
      visibility: 'private',
      completedAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      assigneeMemberId: null,
      assignmentStatus: 'unassigned',
      recurrenceRuleId: null,
    });
  });

  it('falls back safely to "normal" for an unrecognized priority value', () => {
    // CHECK constraints aren't reflected in the generated row type.
    expect(mapTaskRow({ ...BASE_ROW, priority: 'urgent' }).priority).toBe('normal');
  });

  it('falls back safely to "private" for an unrecognized visibility value', () => {
    expect(mapTaskRow({ ...BASE_ROW, visibility: 'public' }).visibility).toBe('private');
  });

  it('falls back safely to "unassigned" for an unrecognized assignment_status value', () => {
    expect(mapTaskRow({ ...BASE_ROW, assignment_status: 'bogus' }).assignmentStatus).toBe(
      'unassigned',
    );
  });

  it('surfaces assignee_member_id and assignment_status for a shared task (Phase 5)', () => {
    const mapped = mapTaskRow({
      ...BASE_ROW,
      family_id: 'f1',
      visibility: 'family',
      assignee_member_id: 'm1',
      assignment_status: 'accepted',
    });
    expect(mapped.assigneeMemberId).toBe('m1');
    expect(mapped.assignmentStatus).toBe('accepted');
  });
});
