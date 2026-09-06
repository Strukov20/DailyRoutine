import { supabase } from '@/lib/supabase/client';

import {
  TaskServiceError,
  acceptTaskAssignment,
  assignFamilyTask,
  completePersonalTask,
  completeSharedTask,
  createPersonalTask,
  createSharedFamilyTask,
  declineTaskAssignment,
  deleteOrArchivePersonalTask,
  listFamilyTasks,
  listInboxTasks,
  listOverdueTasks,
  listPendingAssignments,
  listTasksForDate,
  moveTaskToInbox,
  reassignFamilyTask,
  restorePersonalTask,
  restoreSharedTask,
  schedulePersonalTask,
  takeFamilyTask,
  unassignFamilyTask,
  updatePersonalTask,
} from './taskService';

interface QueryResult {
  data: unknown;
  error: unknown;
}

// See src/lib/family/familyService.test.ts for why this mimics
// supabase-js's PromiseLike query builder rather than a plain mock return.
function makeChain(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.lt = jest.fn(() => chain);
  chain.is = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.or = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

/** Routes `supabase.from(table)` to a different canned result per table. */
function mockFromByTable(resultsByTable: Record<string, QueryResult>) {
  (supabase.from as jest.Mock).mockImplementation((table: string) =>
    makeChain(resultsByTable[table] ?? { data: [], error: null }),
  );
}

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

const TASK_ROW = {
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
  visibility: 'private',
  completed_at: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  assignee_member_id: null,
  assignment_status: 'unassigned',
};

describe('taskService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('personal reads', () => {
    it('listInboxTasks filters by owner and null date', async () => {
      const chain = makeChain({ data: [TASK_ROW], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await listInboxTasks('u1');

      expect(result).toEqual([expect.objectContaining({ id: 't1', title: 'Buy milk' })]);
      expect(chain.eq).toHaveBeenCalledWith('owner_profile_id', 'u1');
      expect(chain.is).toHaveBeenCalledWith('date', null);
    });

    it('listTasksForDate includes owner OR accepted-assignee via .or(), after looking up member ids', async () => {
      mockFromByTable({
        family_members: { data: [{ id: 'm1' }, { id: 'm2' }], error: null },
        tasks: { data: [TASK_ROW], error: null },
      });

      await listTasksForDate('u1', '2026-09-03');

      expect(supabase.from).toHaveBeenCalledWith('family_members');
      expect(supabase.from).toHaveBeenCalledWith('tasks');
      const tasksChain = (supabase.from as jest.Mock).mock.results.find(
        (r, i) => (supabase.from as jest.Mock).mock.calls[i][0] === 'tasks',
      )?.value;
      expect(tasksChain.eq).toHaveBeenCalledWith('date', '2026-09-03');
      expect(tasksChain.or).toHaveBeenCalledWith(
        'owner_profile_id.eq.u1,and(assignee_member_id.in.(m1,m2),assignment_status.eq.accepted)',
      );
    });

    it('listTasksForDate falls back to an owner-only filter when the caller has no family memberships', async () => {
      mockFromByTable({
        family_members: { data: [], error: null },
        tasks: { data: [], error: null },
      });

      await listTasksForDate('u1', '2026-09-03');

      const tasksChain = (supabase.from as jest.Mock).mock.results.find(
        (r, i) => (supabase.from as jest.Mock).mock.calls[i][0] === 'tasks',
      )?.value;
      expect(tasksChain.or).toHaveBeenCalledWith('owner_profile_id.eq.u1');
    });

    it('listOverdueTasks filters by date-before and not-completed, plus the owner-or-accepted-assignee filter', async () => {
      mockFromByTable({
        family_members: { data: [{ id: 'm1' }], error: null },
        tasks: { data: [], error: null },
      });

      await listOverdueTasks('u1', '2026-09-03');

      const tasksChain = (supabase.from as jest.Mock).mock.results.find(
        (r, i) => (supabase.from as jest.Mock).mock.calls[i][0] === 'tasks',
      )?.value;
      expect(tasksChain.lt).toHaveBeenCalledWith('date', '2026-09-03');
      expect(tasksChain.is).toHaveBeenCalledWith('completed_at', null);
    });
  });

  describe('shared-task reads', () => {
    it('listFamilyTasks filters by family_id and visibility=family', async () => {
      const chain = makeChain({
        data: [{ ...TASK_ROW, family_id: 'f1', visibility: 'family' }],
        error: null,
      });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await listFamilyTasks('f1');

      expect(result).toHaveLength(1);
      expect(chain.eq).toHaveBeenCalledWith('family_id', 'f1');
      expect(chain.eq).toHaveBeenCalledWith('visibility', 'family');
    });

    it("listPendingAssignments queries by the caller's member ids and pending_acceptance", async () => {
      mockFromByTable({
        family_members: { data: [{ id: 'm1' }], error: null },
        tasks: { data: [{ ...TASK_ROW, assignment_status: 'pending_acceptance' }], error: null },
      });

      const result = await listPendingAssignments('u1');

      expect(result).toHaveLength(1);
      const tasksChain = (supabase.from as jest.Mock).mock.results.find(
        (r, i) => (supabase.from as jest.Mock).mock.calls[i][0] === 'tasks',
      )?.value;
      expect(tasksChain.in).toHaveBeenCalledWith('assignee_member_id', ['m1']);
      expect(tasksChain.eq).toHaveBeenCalledWith('assignment_status', 'pending_acceptance');
    });

    it('listPendingAssignments short-circuits to an empty list with no family memberships', async () => {
      mockFromByTable({ family_members: { data: [], error: null } });

      await expect(listPendingAssignments('u1')).resolves.toEqual([]);
      expect(supabase.from).not.toHaveBeenCalledWith('tasks');
    });
  });

  describe('personal mutations', () => {
    it('createPersonalTask returns the new task id', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: 't1', error: null });

      await expect(createPersonalTask({ title: 'Buy milk' })).resolves.toBe('t1');
      expect(supabase.rpc).toHaveBeenCalledWith(
        'create_personal_task',
        expect.objectContaining({ p_title: 'Buy milk' }),
      );
    });

    it('updatePersonalTask/completePersonalTask/restorePersonalTask/schedulePersonalTask/moveTaskToInbox/deleteOrArchivePersonalTask resolve on success', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      await expect(updatePersonalTask({ taskId: 't1', title: 'Renamed' })).resolves.toBeUndefined();
      await expect(completePersonalTask('t1')).resolves.toBeUndefined();
      await expect(restorePersonalTask('t1')).resolves.toBeUndefined();
      await expect(
        schedulePersonalTask({ taskId: 't1', date: '2026-09-03' }),
      ).resolves.toBeUndefined();
      await expect(moveTaskToInbox('t1')).resolves.toBeUndefined();
      await expect(deleteOrArchivePersonalTask('t1')).resolves.toBeUndefined();
    });
  });

  describe('shared-task mutations', () => {
    it('createSharedFamilyTask returns the new task id and passes an optional assignee', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: 't1', error: null });

      await expect(
        createSharedFamilyTask({ familyId: 'f1', title: 'Groceries', assigneeMemberId: 'm1' }),
      ).resolves.toBe('t1');
      expect(supabase.rpc).toHaveBeenCalledWith(
        'create_shared_family_task',
        expect.objectContaining({
          p_family_id: 'f1',
          p_title: 'Groceries',
          p_assignee_member_id: 'm1',
        }),
      );
    });

    it('assign/reassign/unassign/take/accept/decline/complete/restore all resolve on success', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });

      await expect(assignFamilyTask('t1', 'm1')).resolves.toBeUndefined();
      expect(supabase.rpc).toHaveBeenCalledWith('assign_family_task', {
        p_task_id: 't1',
        p_assignee_member_id: 'm1',
      });

      await expect(reassignFamilyTask('t1', 'm2')).resolves.toBeUndefined();
      expect(supabase.rpc).toHaveBeenCalledWith('reassign_family_task', {
        p_task_id: 't1',
        p_assignee_member_id: 'm2',
      });

      await expect(unassignFamilyTask('t1')).resolves.toBeUndefined();
      await expect(takeFamilyTask('t1')).resolves.toBeUndefined();
      await expect(acceptTaskAssignment('t1')).resolves.toBeUndefined();
      await expect(declineTaskAssignment('t1')).resolves.toBeUndefined();
      await expect(completeSharedTask('t1')).resolves.toBeUndefined();
      await expect(restoreSharedTask('t1')).resolves.toBeUndefined();
    });
  });

  describe('error normalization', () => {
    it.each([
      ['42501', 'forbidden'],
      ['22023', 'invalid_input'],
      ['23514', 'invalid_input'],
      ['40001', 'conflict'],
      ['some_unmapped_code', 'unknown'],
    ])('maps SQLSTATE %s to TaskErrorCode %s', async (sqlState, expectedCode) => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        error: { code: sqlState, message: 'boom' },
      });

      let caught: unknown;
      try {
        await completePersonalTask('t1');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TaskServiceError);
      expect((caught as TaskServiceError).code).toBe(expectedCode);
    });

    it('take_family_task conflict (someone else already took it) normalizes to "conflict"', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        error: { code: '40001', message: 'task has already been taken' },
      });

      let caught: unknown;
      try {
        await takeFamilyTask('t1');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TaskServiceError);
      expect((caught as TaskServiceError).code).toBe('conflict');
    });
  });
});
