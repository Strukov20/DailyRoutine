import { buildDaySections, buildTodaySections } from './sections';
import type { Task } from './types';

const BASE: Task = {
  id: 't0',
  ownerProfileId: 'u1',
  familyId: null,
  title: 'Task',
  description: null,
  date: '2026-09-03',
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
};

function task(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

describe('buildDaySections', () => {
  it('sorts timed tasks earliest-first', () => {
    const late = task({ id: 'late', startTime: '18:00:00' });
    const early = task({ id: 'early', startTime: '08:00:00' });
    const mid = task({ id: 'mid', startTime: '12:30:00' });

    const { timed } = buildDaySections([late, early, mid]);

    expect(timed.map((t) => t.id)).toEqual(['early', 'mid', 'late']);
  });

  it('sorts Anytime tasks by priority (critical first), then creation order', () => {
    const normalFirst = task({
      id: 'normal-1',
      priority: 'normal',
      createdAt: '2026-09-01T00:00:00Z',
    });
    const normalSecond = task({
      id: 'normal-2',
      priority: 'normal',
      createdAt: '2026-09-02T00:00:00Z',
    });
    const critical = task({
      id: 'critical',
      priority: 'critical',
      createdAt: '2026-09-03T00:00:00Z',
    });
    const important = task({
      id: 'important',
      priority: 'important',
      createdAt: '2026-09-01T12:00:00Z',
    });

    const { anytime } = buildDaySections([normalSecond, normalFirst, critical, important]);

    expect(anytime.map((t) => t.id)).toEqual(['critical', 'important', 'normal-1', 'normal-2']);
  });

  it('separates completed tasks from active ones, most-recently-completed first', () => {
    const activeOne = task({ id: 'active' });
    const completedOld = task({ id: 'old', completedAt: '2026-09-01T10:00:00Z' });
    const completedNew = task({ id: 'new', completedAt: '2026-09-02T10:00:00Z' });

    const sections = buildDaySections([activeOne, completedOld, completedNew]);

    expect(sections.completed.map((t) => t.id)).toEqual(['new', 'old']);
    expect(sections.anytime.map((t) => t.id)).toEqual(['active']);
  });

  it('never puts a completed task in the timed or anytime bucket', () => {
    const completedTimed = task({
      id: 'ct',
      startTime: '09:00:00',
      completedAt: '2026-09-01T00:00:00Z',
    });
    const sections = buildDaySections([completedTimed]);

    expect(sections.timed).toEqual([]);
    expect(sections.anytime).toEqual([]);
    expect(sections.completed.map((t) => t.id)).toEqual(['ct']);
  });
});

describe('buildTodaySections', () => {
  it('overdue-first ordering: oldest date first, then priority within the same date', () => {
    const olderOverdue = task({ id: 'older', date: '2026-09-01' });
    const newerOverdueCritical = task({
      id: 'newer-critical',
      date: '2026-09-02',
      priority: 'critical',
    });
    const newerOverdueNormal = task({ id: 'newer-normal', date: '2026-09-02', priority: 'normal' });

    const { overdue } = buildTodaySections(
      [newerOverdueNormal, olderOverdue, newerOverdueCritical],
      [],
    );

    expect(overdue.map((t) => t.id)).toEqual(['older', 'newer-critical', 'newer-normal']);
  });

  it('excludes already-completed tasks from the overdue bucket (they do not need surfacing as overdue)', () => {
    const completedOverdue = task({
      id: 'done',
      date: '2026-08-01',
      completedAt: '2026-08-02T00:00:00Z',
    });
    const { overdue } = buildTodaySections([completedOverdue], []);

    expect(overdue).toEqual([]);
  });

  it("keeps overdue and today's own tasks as separate inputs/outputs", () => {
    const overdueTask = task({ id: 'overdue', date: '2026-09-01' });
    const todayTimed = task({ id: 'today-timed', date: '2026-09-03', startTime: '09:00:00' });

    const sections = buildTodaySections([overdueTask], [todayTimed]);

    expect(sections.overdue.map((t) => t.id)).toEqual(['overdue']);
    expect(sections.timed.map((t) => t.id)).toEqual(['today-timed']);
  });
});
