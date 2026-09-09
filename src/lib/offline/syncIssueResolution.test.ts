import { queryClient } from '@/lib/query/queryClient';
import type { Task } from '@/domain/tasks/types';

import { useOfflineQueueStore } from './offlineQueueStore';
import {
  applyMyChange,
  buildComparisonFields,
  discardSyncIssue,
  getConflictComparison,
  getLocalChangeFields,
  isRetryEligible,
  reloadServerSnapshot,
  retrySyncIssue,
} from './syncIssueResolution';
import type { OfflineOperation } from './types';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockGetTask = jest.fn();
const mockUpdatePersonalTask = jest.fn();
const mockSchedulePersonalTask = jest.fn();

jest.mock('@/lib/tasks/taskService', () => {
  const actual = jest.requireActual('@/lib/tasks/taskService');
  return {
    ...actual,
    getTask: (...args: unknown[]) => mockGetTask(...args),
    updatePersonalTask: (...args: unknown[]) => mockUpdatePersonalTask(...args),
    schedulePersonalTask: (...args: unknown[]) => mockSchedulePersonalTask(...args),
  };
});

function fakeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    ownerProfileId: 'profile-a',
    familyId: null,
    title: 'Server title',
    description: null,
    date: '2026-01-05',
    startTime: null,
    durationMinutes: null,
    timezone: null,
    priority: 'normal',
    categoryId: null,
    visibility: 'private',
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    assigneeMemberId: null,
    assignmentStatus: 'unassigned',
    ...overrides,
  };
}

function fakeOp(overrides: Partial<OfflineOperation> = {}): OfflineOperation {
  return {
    operationId: 'op-1',
    profileId: 'profile-a',
    operationType: 'update_personal_task',
    entityId: 'task-1',
    clientGeneratedId: null,
    payload: { title: 'Local title' },
    expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    attemptCount: 1,
    status: 'conflict',
    lastSafeErrorCode: 'conflict',
    ...overrides,
  };
}

async function seedQueue(operation: OfflineOperation) {
  await useOfflineQueueStore.getState().hydrate('profile-a');
  useOfflineQueueStore.setState({ operations: [operation] });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: null, operations: [], isReplaying: false });
});

describe('buildComparisonFields', () => {
  it('includes only the fields the local update payload actually touched', () => {
    const op = fakeOp({ payload: { title: 'Local title' } });
    const fields = buildComparisonFields(op, fakeTask());
    expect(fields).toEqual([{ field: 'title', local: 'Local title', server: 'Server title' }]);
  });

  it('shows the schedule fields for a schedule_personal_task operation', () => {
    const op = fakeOp({
      operationType: 'schedule_personal_task',
      payload: { date: '2026-02-01', durationMinutes: 30 },
    });
    const fields = buildComparisonFields(op, fakeTask({ date: '2026-01-05', durationMinutes: 15 }));
    expect(fields).toEqual([
      { field: 'date', local: '2026-02-01', server: '2026-01-05' },
      { field: 'durationMinutes', local: '30', server: '15' },
    ]);
  });
});

describe('getLocalChangeFields', () => {
  it('shows only local values, never a server value, for a non-conflict issue', () => {
    const op = fakeOp({ status: 'retry_wait', lastSafeErrorCode: null, payload: { title: 'Local title' } });
    const fields = getLocalChangeFields(op);
    expect(fields).toEqual([{ field: 'title', local: 'Local title', server: null }]);
  });
});

describe('getConflictComparison', () => {
  it('fetches the server task through the authenticated repository and returns both sides', async () => {
    mockGetTask.mockResolvedValue(fakeTask());
    await seedQueue(fakeOp());

    const comparison = await getConflictComparison('op-1');

    expect(mockGetTask).toHaveBeenCalledWith('task-1');
    expect(comparison?.serverTask?.title).toBe('Server title');
    expect(comparison?.fields).toEqual([{ field: 'title', local: 'Local title', server: 'Server title' }]);
  });

  it('returns a null serverTask (never throws) when the task no longer exists or is no longer authorized', async () => {
    mockGetTask.mockResolvedValue(null);
    await seedQueue(fakeOp());

    const comparison = await getConflictComparison('op-1');

    expect(comparison).toEqual({ serverTask: null, fields: [] });
  });

  it('returns null for an operation type comparison does not apply to (e.g. complete_task_occurrence)', async () => {
    await seedQueue(fakeOp({ operationType: 'complete_task_occurrence' }));
    expect(await getConflictComparison('op-1')).toBeNull();
    expect(mockGetTask).not.toHaveBeenCalled();
  });

  it('returns null for an unknown operationId (stale deep link) without throwing', async () => {
    await seedQueue(fakeOp());
    expect(await getConflictComparison('does-not-exist')).toBeNull();
  });
});

describe('reloadServerSnapshot', () => {
  it('refreshes the comparison without discarding the local pending operation', async () => {
    mockGetTask.mockResolvedValue(fakeTask());
    await seedQueue(fakeOp());

    await reloadServerSnapshot('op-1');

    const op = useOfflineQueueStore.getState().operations.find((o) => o.operationId === 'op-1');
    expect(op).toBeDefined();
    expect(op?.status).toBe('conflict');
  });

  it('transitions to a safe entity_deleted state when the entity disappeared or authorization changed mid-review', async () => {
    mockGetTask.mockResolvedValue(null);
    await seedQueue(fakeOp());

    await reloadServerSnapshot('op-1');

    const op = useOfflineQueueStore.getState().operations.find((o) => o.operationId === 'op-1');
    expect(op?.status).toBe('permanent_failure');
    expect(op?.lastSafeErrorCode).toBe('entity_deleted');
  });
});

describe('discardSyncIssue (Keep server version)', () => {
  it('removes the operation so it can never replay again, and invalidates task/recurrence queries', async () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    await seedQueue(fakeOp());

    await discardSyncIssue('op-1');

    expect(useOfflineQueueStore.getState().operations).toEqual([]);
    expect(invalidateSpy).toHaveBeenCalled();
    invalidateSpy.mockRestore();
  });

  it('is idempotent — discarding an already-resolved (missing) operation is a safe no-op, never throws', async () => {
    await seedQueue(fakeOp());
    await discardSyncIssue('op-1');

    await expect(discardSyncIssue('op-1')).resolves.toBeUndefined();
    expect(useOfflineQueueStore.getState().operations).toEqual([]);
  });
});

describe('applyMyChange', () => {
  it('refetches the latest server version, reapplies the original patch against it, and removes the operation on success', async () => {
    mockGetTask.mockResolvedValue(fakeTask({ updatedAt: '2026-01-03T00:00:00.000Z' }));
    mockUpdatePersonalTask.mockResolvedValue(undefined);
    await seedQueue(fakeOp());

    const outcome = await applyMyChange('op-1');

    expect(outcome).toEqual({ result: 'succeeded' });
    expect(mockUpdatePersonalTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', expectedUpdatedAt: '2026-01-03T00:00:00.000Z', title: 'Local title' }),
    );
    expect(useOfflineQueueStore.getState().operations).toEqual([]);
  });

  it('never overwrites fields outside the original local patch — the payload sent is exactly the original patch', async () => {
    mockGetTask.mockResolvedValue(fakeTask({ updatedAt: '2026-01-03T00:00:00.000Z' }));
    mockUpdatePersonalTask.mockResolvedValue(undefined);
    await seedQueue(fakeOp({ payload: { title: 'Local title' } }));

    await applyMyChange('op-1');

    const sentPayload = mockUpdatePersonalTask.mock.calls[0][0];
    expect(Object.keys(sentPayload).sort()).toEqual(['expectedUpdatedAt', 'taskId', 'title'].sort());
  });

  it('stays in "conflict" (never falls back to last-write-wins) when another update happened between review and apply', async () => {
    const { TaskServiceError } = jest.requireActual('@/lib/tasks/taskService');
    mockGetTask.mockResolvedValue(fakeTask({ updatedAt: '2026-01-03T00:00:00.000Z' }));
    mockUpdatePersonalTask.mockRejectedValue(new TaskServiceError('conflict', 'stale write'));
    await seedQueue(fakeOp());

    const outcome = await applyMyChange('op-1');

    expect(outcome).toEqual({ result: 'conflict' });
    const op = useOfflineQueueStore.getState().operations.find((o) => o.operationId === 'op-1');
    expect(op?.status).toBe('conflict');
  });

  it('transitions to entity_deleted (never applies) when the task disappeared before Apply could run', async () => {
    mockGetTask.mockResolvedValue(null);
    await seedQueue(fakeOp());

    const outcome = await applyMyChange('op-1');

    expect(outcome).toEqual({ result: 'not_applicable' });
    expect(mockUpdatePersonalTask).not.toHaveBeenCalled();
    const op = useOfflineQueueStore.getState().operations.find((o) => o.operationId === 'op-1');
    expect(op?.status).toBe('permanent_failure');
    expect(op?.lastSafeErrorCode).toBe('entity_deleted');
  });

  it('is a safe no-op ("not_applicable") when the operation is not actually a conflict — double-tap idempotency', async () => {
    await seedQueue(fakeOp({ status: 'retry_wait', lastSafeErrorCode: null }));

    const outcome = await applyMyChange('op-1');

    expect(outcome).toEqual({ result: 'not_applicable' });
    expect(mockGetTask).not.toHaveBeenCalled();
  });
});

describe('isRetryEligible / retrySyncIssue', () => {
  it('is eligible for retry_wait and for a permanent_failure whose reason is "unknown"', () => {
    expect(isRetryEligible(fakeOp({ status: 'retry_wait' }))).toBe(true);
    expect(isRetryEligible(fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'unknown' }))).toBe(true);
  });

  it('is never eligible for a conflict or a non-unknown permanent failure', () => {
    expect(isRetryEligible(fakeOp({ status: 'conflict', lastSafeErrorCode: 'conflict' }))).toBe(false);
    expect(
      isRetryEligible(fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'permanent_validation' })),
    ).toBe(false);
  });

  it('marks the operation retry_wait and triggers the shared queue worker, which removes it on success', async () => {
    mockUpdatePersonalTask.mockResolvedValue(undefined);
    await seedQueue(fakeOp({ status: 'retry_wait', lastSafeErrorCode: 'unknown', operationType: 'update_personal_task' }));

    const marked = await retrySyncIssue('op-1');
    expect(marked).toBe(true);
    // Let the worker's async pass settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useOfflineQueueStore.getState().operations).toEqual([]);
  });

  it('two concurrent Retry taps join the same replay pass rather than double-processing (prevents simultaneous duplicate retries)', async () => {
    let resolveUpdate: () => void = () => {};
    mockUpdatePersonalTask.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    await seedQueue(fakeOp({ status: 'retry_wait', lastSafeErrorCode: 'unknown', operationType: 'update_personal_task' }));

    const first = retrySyncIssue('op-1');
    const second = retrySyncIssue('op-1');
    resolveUpdate();
    await Promise.all([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockUpdatePersonalTask).toHaveBeenCalledTimes(1);
  });

  it('does not retry a conflict or non-retryable permanent failure', async () => {
    await seedQueue(fakeOp({ status: 'conflict', lastSafeErrorCode: 'conflict' }));
    expect(await retrySyncIssue('op-1')).toBe(false);
    expect(mockUpdatePersonalTask).not.toHaveBeenCalled();
  });
});
