import { supabase } from '@/lib/supabase/client';

import {
  TaskServiceError,
  completePersonalTask,
  createPersonalTask,
  deleteOrArchivePersonalTask,
  listInboxTasks,
  listOverdueTasks,
  listTasksForDate,
  moveTaskToInbox,
  restorePersonalTask,
  schedulePersonalTask,
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
  chain.order = jest.fn(() => chain);
  chain.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
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
};

describe('taskService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('reads', () => {
    it('listInboxTasks filters by owner and null date', async () => {
      const chain = makeChain({ data: [TASK_ROW], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      const result = await listInboxTasks('u1');

      expect(result).toEqual([expect.objectContaining({ id: 't1', title: 'Buy milk' })]);
      expect(chain.eq).toHaveBeenCalledWith('owner_profile_id', 'u1');
      expect(chain.is).toHaveBeenCalledWith('date', null);
    });

    it('listTasksForDate filters by owner and exact date', async () => {
      const chain = makeChain({ data: [TASK_ROW], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await listTasksForDate('u1', '2026-09-03');

      expect(chain.eq).toHaveBeenCalledWith('owner_profile_id', 'u1');
      expect(chain.eq).toHaveBeenCalledWith('date', '2026-09-03');
    });

    it('listOverdueTasks filters by owner, date before, and not completed', async () => {
      const chain = makeChain({ data: [], error: null });
      (supabase.from as jest.Mock).mockReturnValue(chain);

      await listOverdueTasks('u1', '2026-09-03');

      expect(chain.eq).toHaveBeenCalledWith('owner_profile_id', 'u1');
      expect(chain.lt).toHaveBeenCalledWith('date', '2026-09-03');
      expect(chain.is).toHaveBeenCalledWith('completed_at', null);
    });
  });

  describe('mutations', () => {
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

  describe('error normalization', () => {
    it.each([
      ['42501', 'forbidden'],
      ['22023', 'invalid_input'],
      ['23514', 'invalid_input'],
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
  });
});
