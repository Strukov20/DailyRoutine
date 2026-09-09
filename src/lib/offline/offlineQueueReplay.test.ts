import { onlineManager } from '@tanstack/react-query';

import { queryClient } from '@/lib/query/queryClient';
import { TaskServiceError } from '@/lib/tasks/taskService';

import { runOfflineQueueReplay } from './offlineQueueReplay';
import { useOfflineQueueStore } from './offlineQueueStore';
import { MAX_ATTEMPTS_BEFORE_GIVING_UP, type OfflineOperation } from './types';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockCreatePersonalTask = jest.fn();
const mockUpdatePersonalTask = jest.fn();
const mockSchedulePersonalTask = jest.fn();
const mockCompletePersonalTask = jest.fn();
const mockRestorePersonalTask = jest.fn();
const mockDeleteOrArchivePersonalTask = jest.fn();

jest.mock('@/lib/tasks/taskService', () => {
  const actual = jest.requireActual('@/lib/tasks/taskService');
  return {
    ...actual,
    createPersonalTask: (...args: unknown[]) => mockCreatePersonalTask(...args),
    updatePersonalTask: (...args: unknown[]) => mockUpdatePersonalTask(...args),
    schedulePersonalTask: (...args: unknown[]) => mockSchedulePersonalTask(...args),
    completePersonalTask: (...args: unknown[]) => mockCompletePersonalTask(...args),
    restorePersonalTask: (...args: unknown[]) => mockRestorePersonalTask(...args),
    deleteOrArchivePersonalTask: (...args: unknown[]) => mockDeleteOrArchivePersonalTask(...args),
  };
});

const mockCompleteOccurrence = jest.fn();
const mockRestoreOccurrence = jest.fn();

jest.mock('@/lib/recurrence/recurrenceService', () => {
  const actual = jest.requireActual('@/lib/recurrence/recurrenceService');
  return {
    ...actual,
    completeOccurrence: (...args: unknown[]) => mockCompleteOccurrence(...args),
    restoreOccurrence: (...args: unknown[]) => mockRestoreOccurrence(...args),
  };
});

function fakeOp(overrides: Partial<OfflineOperation> = {}): OfflineOperation {
  return {
    operationId: 'op-1',
    profileId: 'profile-a',
    operationType: 'create_personal_task',
    entityId: null,
    clientGeneratedId: 'client-1',
    payload: { title: 'Buy milk' },
    expectedUpdatedAt: null,
    reviewedVersion: null,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: 'pending',
    lastSafeErrorCode: null,
    ...overrides,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(onlineManager, 'isOnline').mockReturnValue(true);
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: null, operations: [], isReplaying: false });
  await useOfflineQueueStore.getState().hydrate('profile-a');
});

describe('runOfflineQueueReplay', () => {
  it('replays a pending create, removes it on success, and invalidates task queries', async () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    mockCreatePersonalTask.mockResolvedValue('server-task-1');
    await useOfflineQueueStore.getState().enqueue(fakeOp());

    await runOfflineQueueReplay();

    expect(mockCreatePersonalTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Buy milk', clientOperationId: 'op-1' }),
    );
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('remaps a dependent op queued against an offline-created task\'s clientGeneratedId to the real server id once the create replays', async () => {
    mockCreatePersonalTask.mockResolvedValue('server-task-1');
    mockCompletePersonalTask.mockResolvedValue(undefined);
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationId: 'op-create', clientGeneratedId: 'client-1', entityId: null }));
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({
        operationId: 'op-complete',
        operationType: 'complete_personal_task',
        entityId: 'client-1',
        clientGeneratedId: null,
      }),
    );

    await runOfflineQueueReplay();

    expect(mockCompletePersonalTask).toHaveBeenCalledWith('server-task-1');
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
  });

  it('replays operations in FIFO order', async () => {
    mockCompletePersonalTask.mockResolvedValue(undefined);
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationId: 'op-1', operationType: 'complete_personal_task', entityId: 'task-1' }));
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationId: 'op-2', operationType: 'complete_personal_task', entityId: 'task-2' }));

    await runOfflineQueueReplay();

    expect(mockCompletePersonalTask.mock.calls).toEqual([['task-1'], ['task-2']]);
  });

  it('marks a permanent (forbidden) failure as failed and keeps draining the rest of the queue', async () => {
    mockCompletePersonalTask.mockRejectedValueOnce(new TaskServiceError('forbidden', 'nope'));
    mockRestorePersonalTask.mockResolvedValue(undefined);
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationId: 'op-1', operationType: 'complete_personal_task', entityId: 'task-1' }));
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationId: 'op-2', operationType: 'restore_personal_task', entityId: 'task-2' }));

    await runOfflineQueueReplay();

    const ops = useOfflineQueueStore.getState().operations;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      operationId: 'op-1',
      status: 'permanent_failure',
      lastSafeErrorCode: 'task_unavailable',
    });
    expect(mockRestorePersonalTask).toHaveBeenCalledWith('task-2');
  });

  it('marks a stale-write conflict as "conflict" (needs review) without retrying (never silently overwrites)', async () => {
    mockUpdatePersonalTask.mockRejectedValue(new TaskServiceError('conflict', 'stale'));
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({
        operationType: 'update_personal_task',
        entityId: 'task-1',
        expectedUpdatedAt: '2026-01-01T00:00:00Z',
        payload: { title: 'Renamed' },
      }),
    );

    await runOfflineQueueReplay();

    expect(useOfflineQueueStore.getState().operations[0]).toMatchObject({
      status: 'conflict',
      lastSafeErrorCode: 'conflict',
    });
    expect(mockUpdatePersonalTask).toHaveBeenCalledTimes(1);
  });

  it('marks a "not found" (forbidden — never a distinct not_found code) failure as "task_unavailable", indistinguishable from any other forbidden cause', async () => {
    mockUpdatePersonalTask.mockRejectedValue(new TaskServiceError('forbidden', 'task unavailable'));
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationType: 'update_personal_task', entityId: 'task-1' }));

    await runOfflineQueueReplay();

    expect(useOfflineQueueStore.getState().operations[0]).toMatchObject({
      status: 'permanent_failure',
      lastSafeErrorCode: 'task_unavailable',
    });
  });

  it('leaves a transient (unknown) failure in retry_wait and stops the pass, for the next trigger to retry', async () => {
    mockCompletePersonalTask.mockRejectedValue(new Error('network blip'));
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationType: 'complete_personal_task', entityId: 'task-1', attemptCount: 0 }));

    await runOfflineQueueReplay();

    const op = useOfflineQueueStore.getState().operations[0];
    expect(op?.status).toBe('retry_wait');
    expect(op?.attemptCount).toBe(1);
  });

  it('gives up and marks permanent_failure once a transient failure exhausts its attempt budget', async () => {
    mockCompletePersonalTask.mockRejectedValue(new Error('network blip'));
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({
        operationType: 'complete_personal_task',
        entityId: 'task-1',
        attemptCount: MAX_ATTEMPTS_BEFORE_GIVING_UP - 1,
      }),
    );

    await runOfflineQueueReplay();

    expect(useOfflineQueueStore.getState().operations[0]).toMatchObject({
      status: 'permanent_failure',
      lastSafeErrorCode: 'unknown',
    });
  });

  it('does nothing while offline', async () => {
    jest.spyOn(onlineManager, 'isOnline').mockReturnValue(false);
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationType: 'complete_personal_task', entityId: 'task-1' }));

    await runOfflineQueueReplay();

    expect(mockCompletePersonalTask).not.toHaveBeenCalled();
    expect(useOfflineQueueStore.getState().operations[0]?.status).toBe('pending');
  });

  it('runs only one worker at a time — a concurrent call joins the same in-flight replay rather than double-processing', async () => {
    let resolveFirst!: (value: string) => void;
    mockCreatePersonalTask.mockReturnValue(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    await useOfflineQueueStore.getState().enqueue(fakeOp());

    const first = runOfflineQueueReplay();
    const second = runOfflineQueueReplay();
    resolveFirst('server-task-1');
    await Promise.all([first, second]);

    expect(mockCreatePersonalTask).toHaveBeenCalledTimes(1);
  });

  it('replays a queued recurring-occurrence completion against the real occurrence RPC', async () => {
    mockCompleteOccurrence.mockResolvedValue(undefined);
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationType: 'complete_task_occurrence', entityId: 'occ-1' }));

    await runOfflineQueueReplay();

    expect(mockCompleteOccurrence).toHaveBeenCalledWith('occ-1');
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
  });

  it('replays a queued recurring-occurrence restore against the real occurrence RPC', async () => {
    mockRestoreOccurrence.mockResolvedValue(undefined);
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationType: 'restore_task_occurrence', entityId: 'occ-1' }));

    await runOfflineQueueReplay();

    expect(mockRestoreOccurrence).toHaveBeenCalledWith('occ-1');
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
  });

  it('classifies a RecurrenceServiceError the same way a TaskServiceError is classified (permanent vs. retry)', async () => {
    const { RecurrenceServiceError } = jest.requireActual('@/lib/recurrence/recurrenceService');
    mockCompleteOccurrence.mockRejectedValue(new RecurrenceServiceError('forbidden', 'nope'));
    await useOfflineQueueStore
      .getState()
      .enqueue(fakeOp({ operationType: 'complete_task_occurrence', entityId: 'occ-1' }));

    await runOfflineQueueReplay();

    expect(useOfflineQueueStore.getState().operations[0]).toMatchObject({
      status: 'permanent_failure',
      lastSafeErrorCode: 'task_unavailable',
    });
  });
});
