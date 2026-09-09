import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { useOfflineQueueStore } from '@/lib/offline/offlineQueueStore';
import { completePersonalTask, createPersonalTask } from '@/lib/tasks/taskService';

import {
  taskKeys,
  useCompletePersonalTask,
  useCreatePersonalTask,
  useDeletePersonalTask,
} from './hooks';
import type { Task } from './types';

// Phase 9 — hooks.ts now pulls in the offline queue store, which pulls in
// AsyncStorage; same convention as persistedQueryClient.test.ts.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// See src/components/calendar/CalendarScreen.test.tsx for why NetInfo is
// mocked at this boundary — its real native module doesn't initialize
// under this project's test environment. Mutable so individual tests can
// exercise the offline branch.
let mockIsConnected = true;
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: mockIsConnected }),
}));

class MockTaskServiceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TaskServiceError';
    this.code = code;
  }
}

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
  TaskServiceError: MockTaskServiceError,
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

beforeEach(async () => {
  mockIsConnected = true;
  // The offline queue store is the real module (not mocked) — hydrate it
  // for 'u1' so enqueue() (which refuses to enqueue for an un-hydrated or
  // mismatched profile) works the same way it does once the app's own
  // useOfflineQueueSync has run.
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: null, operations: [], isReplaying: false });
  await useOfflineQueueStore.getState().hydrate('u1');
});

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

describe('Phase 9 — offline queueing', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('useCreatePersonalTask enqueues (never calls the RPC) and optimistically prepends the new task to Inbox while offline', async () => {
    mockIsConnected = false;
    const client = new QueryClient();

    const { result } = await renderHook(() => useCreatePersonalTask(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ title: 'Buy milk' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createPersonalTask).not.toHaveBeenCalled();
    expect(useOfflineQueueStore.getState().operations).toHaveLength(1);
    expect(useOfflineQueueStore.getState().operations[0]).toMatchObject({
      operationType: 'create_personal_task',
      profileId: 'u1',
    });

    const cached = client.getQueryData<Task[]>(taskKeys.inbox('u1'));
    expect(cached).toHaveLength(1);
    expect(cached?.[0]?.title).toBe('Buy milk');
    expect(cached?.[0]?.id).toBe(result.current.data);
  });

  it('useCreatePersonalTask refuses a dated (scheduled) create while offline, without queueing or touching the cache', async () => {
    mockIsConnected = false;
    const client = new QueryClient();

    const { result } = await renderHook(() => useCreatePersonalTask(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ title: 'Dentist', date: '2026-10-01' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(createPersonalTask).not.toHaveBeenCalled();
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
  });

  it('useCreatePersonalTask still calls the real RPC while online (offline queueing never intercepts a normal create)', async () => {
    (createPersonalTask as jest.Mock).mockResolvedValue('server-task-1');
    const client = new QueryClient();

    const { result } = await renderHook(() => useCreatePersonalTask(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ title: 'Buy milk' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createPersonalTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Buy milk' }));
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
  });

  it('useCompletePersonalTask enqueues instead of calling the RPC while offline, while still applying the same optimistic update', async () => {
    mockIsConnected = false;
    const client = makeClientWithInbox(new QueryClient());

    const { result } = await renderHook(() => useCompletePersonalTask(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate('t1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(completePersonalTask).not.toHaveBeenCalled();
    expect(useOfflineQueueStore.getState().operations).toHaveLength(1);
    expect(useOfflineQueueStore.getState().operations[0]).toMatchObject({
      operationType: 'complete_personal_task',
      entityId: 't1',
    });
    const cached = client.getQueryData<Task[]>(taskKeys.inbox('u1'));
    expect(cached?.[0]?.completedAt).not.toBeNull();
  });

  it('useDeletePersonalTask enqueues and optimistically removes the task from every cached list while offline', async () => {
    mockIsConnected = false;
    const client = makeClientWithInbox(new QueryClient());

    const { result } = await renderHook(() => useDeletePersonalTask(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate('t1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useOfflineQueueStore.getState().operations).toHaveLength(1);
    expect(client.getQueryData<Task[]>(taskKeys.inbox('u1'))).toEqual([]);
  });

  it('surfaces a full offline queue as a mutation error, never a silently dropped operation', async () => {
    mockIsConnected = false;
    useOfflineQueueStore.setState({
      operations: Array.from({ length: 200 }, (_, i) => ({
        operationId: `existing-${i}`,
        profileId: 'u1',
        operationType: 'complete_personal_task' as const,
        entityId: `task-${i}`,
        clientGeneratedId: null,
        payload: {},
        expectedUpdatedAt: null,
        createdAt: new Date().toISOString(),
        attemptCount: 0,
        status: 'pending' as const,
        lastSafeErrorCode: null,
      })),
    });
    const client = new QueryClient();

    const { result } = await renderHook(() => useCreatePersonalTask(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      result.current.mutate({ title: 'One too many' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<Task[]>(taskKeys.inbox('u1'))).toBeUndefined();
  });
});
