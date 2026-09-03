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
  it('maps a row 1:1 for the normal case', () => {
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
    });
  });

  it('falls back safely to "normal" for an unrecognized priority value', () => {
    // CHECK constraints aren't reflected in the generated row type.
    expect(mapTaskRow({ ...BASE_ROW, priority: 'urgent' }).priority).toBe('normal');
  });

  it('falls back safely to "private" for an unrecognized visibility value', () => {
    expect(mapTaskRow({ ...BASE_ROW, visibility: 'public' }).visibility).toBe('private');
  });

  it('never surfaces assignee_member_id or assignment_status — not part of the domain Task shape', () => {
    const mapped = mapTaskRow({
      ...BASE_ROW,
      assignee_member_id: 'm1',
      assignment_status: 'accepted',
    });
    expect(mapped).not.toHaveProperty('assigneeMemberId');
    expect(mapped).not.toHaveProperty('assignmentStatus');
  });
});
