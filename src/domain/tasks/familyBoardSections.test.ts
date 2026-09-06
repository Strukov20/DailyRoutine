import { buildFamilyBoardSections } from './familyBoardSections';
import type { Task } from './types';

const BASE: Task = {
  id: 't0',
  ownerProfileId: 'creator',
  familyId: 'f1',
  title: 'Task',
  description: null,
  date: null,
  startTime: null,
  durationMinutes: null,
  timezone: null,
  priority: 'normal',
  categoryId: null,
  visibility: 'family',
  completedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  assigneeMemberId: null,
  assignmentStatus: 'unassigned',
};

function task(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

describe('buildFamilyBoardSections', () => {
  const ME = 'me-profile';
  const MY_MEMBER_ID = 'my-member-id';

  it('puts a pending assignment addressed to me in awaitingMyResponse, not myFamilyTasks', () => {
    const t = task({
      id: 'pending',
      assigneeMemberId: MY_MEMBER_ID,
      assignmentStatus: 'pending_acceptance',
    });
    const sections = buildFamilyBoardSections([t], ME, MY_MEMBER_ID);

    expect(sections.awaitingMyResponse.map((x) => x.id)).toEqual(['pending']);
    expect(sections.myFamilyTasks).toEqual([]);
  });

  it('puts a task I created in myFamilyTasks', () => {
    const t = task({ id: 'mine', ownerProfileId: ME });
    const sections = buildFamilyBoardSections([t], ME, MY_MEMBER_ID);

    expect(sections.myFamilyTasks.map((x) => x.id)).toEqual(['mine']);
  });

  it('puts a task accepted by me (created by someone else) in myFamilyTasks', () => {
    const t = task({
      id: 'accepted-by-me',
      ownerProfileId: 'creator',
      assigneeMemberId: MY_MEMBER_ID,
      assignmentStatus: 'accepted',
    });
    const sections = buildFamilyBoardSections([t], ME, MY_MEMBER_ID);

    expect(sections.myFamilyTasks.map((x) => x.id)).toEqual(['accepted-by-me']);
  });

  it('puts an unassigned task created by someone else in unassigned, not assignedToOthers', () => {
    const t = task({
      id: 'up-for-grabs',
      ownerProfileId: 'creator',
      assignmentStatus: 'unassigned',
    });
    const sections = buildFamilyBoardSections([t], ME, MY_MEMBER_ID);

    expect(sections.unassigned.map((x) => x.id)).toEqual(['up-for-grabs']);
    expect(sections.assignedToOthers).toEqual([]);
  });

  it('puts a task assigned to (or pending on) a different adult in assignedToOthers', () => {
    const pending = task({
      id: 'pending-other',
      ownerProfileId: 'creator',
      assigneeMemberId: 'someone-else',
      assignmentStatus: 'pending_acceptance',
    });
    const accepted = task({
      id: 'accepted-other',
      ownerProfileId: 'creator',
      assigneeMemberId: 'someone-else',
      assignmentStatus: 'accepted',
    });
    const sections = buildFamilyBoardSections([pending, accepted], ME, MY_MEMBER_ID);

    expect(sections.assignedToOthers.map((x) => x.id).sort()).toEqual([
      'accepted-other',
      'pending-other',
    ]);
  });

  it('puts every completed task in completed regardless of who created/was assigned it', () => {
    const myCompleted = task({ id: 'c1', ownerProfileId: ME, completedAt: '2026-09-02T00:00:00Z' });
    const othersCompleted = task({
      id: 'c2',
      ownerProfileId: 'creator',
      assigneeMemberId: 'someone-else',
      completedAt: '2026-09-02T00:00:00Z',
    });
    const sections = buildFamilyBoardSections([myCompleted, othersCompleted], ME, MY_MEMBER_ID);

    expect(sections.completed.map((x) => x.id).sort()).toEqual(['c1', 'c2']);
    expect(sections.myFamilyTasks).toEqual([]);
    expect(sections.assignedToOthers).toEqual([]);
  });

  it('every task appears in exactly one section', () => {
    const tasks = [
      task({ id: 'a', ownerProfileId: ME }),
      task({ id: 'b', assigneeMemberId: MY_MEMBER_ID, assignmentStatus: 'pending_acceptance' }),
      task({ id: 'c', assignmentStatus: 'unassigned' }),
      task({ id: 'd', assigneeMemberId: 'other', assignmentStatus: 'accepted' }),
      task({ id: 'e', completedAt: '2026-09-02T00:00:00Z' }),
    ];
    const sections = buildFamilyBoardSections(tasks, ME, MY_MEMBER_ID);

    const allIds = [
      ...sections.awaitingMyResponse,
      ...sections.myFamilyTasks,
      ...sections.unassigned,
      ...sections.assignedToOthers,
      ...sections.completed,
    ].map((x) => x.id);

    expect(allIds.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(new Set(allIds).size).toBe(tasks.length);
  });

  it('treats every assignment as belonging to someone else when the caller has no membership row in this family', () => {
    const t = task({
      id: 'x',
      assigneeMemberId: 'anything',
      assignmentStatus: 'pending_acceptance',
    });
    const sections = buildFamilyBoardSections([t], ME, null);

    expect(sections.awaitingMyResponse).toEqual([]);
    expect(sections.assignedToOthers.map((x) => x.id)).toEqual(['x']);
  });
});
