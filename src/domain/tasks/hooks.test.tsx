import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { completePersonalTask } from '@/lib/tasks/taskService';

import { taskKeys, useCompletePersonalTask } from './hooks';
import type { Task } from './types';

// Manual factory, not automock — see src/domain/family/hooks.test.tsx for
// why (automock still loads the real module, which pulls in the real
// Supabase client's AsyncStorage native module).
jest.mock('@/lib/tasks/taskService', () => ({
  completePersonalTask: jest.fn(),
  restorePersonalTask: jest.fn(),
  createPersonalTask: jest.fn(),
  updatePersonalTask: jest.fn(),
  schedulePersonalTask: jest.fn(),
  moveTaskToInbox: jest.fn(),
  deleteOrArchivePersonalTask: jest.fn(),
  listInboxTasks: jest.fn(),
  listTasksForDate: jest.fn(),
  listOverdueTasks: jest.fn(),
  getTask: jest.fn(),
}));

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'u1' },
    session: null,
    status: 'signed-in',
    refreshProfile: jest.fn(),
  }),
}));

const TASK: Task = {
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
  assignmentStatus: 'unassigned' as const,
};

function makeClientWithInbox(client: QueryClient) {
  client.setQueryData(taskKeys.inbox('u1'), [TASK]);
  return client;
}

function makeWrapper(client: QueryClient) {
  // eslint-disable-next-line react/display-name -- test-only wrapper
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useCompletePersonalTask', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('optimistically marks the task completed before the server responds', async () => {
    const client = makeClientWithInbox(new QueryClient());
    let resolveRpc: () => void = () => {};
    (completePersonalTask as jest.Mock).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRpc = resolve;
      }),
    );

    const { result } = await renderHook(() => useCompletePersonalTask(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate('t1');
    });

    // Before the RPC resolves, the cache must already reflect completion —
    // that's the whole point of an optimistic update.
    await waitFor(() => {
      const cached = client.getQueryData<Task[]>(taskKeys.inbox('u1'));
      expect(cached?.[0]?.completedAt).not.toBeNull();
    });

    resolveRpc();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('deterministically rolls back the optimistic update on a server failure', async () => {
    const client = makeClientWithInbox(new QueryClient());
    (completePersonalTask as jest.Mock).mockRejectedValue(new Error('network error'));

    const { result } = await renderHook(() => useCompletePersonalTask(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate('t1');
    });

    // mockRejectedValue rejects near-instantly, so the optimistic-update-
    // then-rollback cycle can complete within microtasks before any
    // assertion could observe the transient "still optimistic" state (see
    // the previous test for that state, using a manually-controlled
    // pending Promise instead). What's deterministically checkable here —
    // and what actually matters — is the end state: once the server call
    // fails, the cache must be restored to exactly its pre-mutation value,
    // not left partially patched.
    await waitFor(() => expect(result.current.isError).toBe(true));
    const cached = client.getQueryData<Task[]>(taskKeys.inbox('u1'));
    expect(cached).toEqual([TASK]);
  });
});
