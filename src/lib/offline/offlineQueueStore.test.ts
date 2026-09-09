import {
  selectHasFailedOperations,
  selectIsTaskPendingSync,
  selectOperationById,
  selectPendingOperationCount,
  selectSyncIssueCount,
  selectSyncIssues,
  useOfflineQueueStore,
} from './offlineQueueStore';
import { MAX_OFFLINE_QUEUE_SIZE, type OfflineOperation } from './types';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function fakeOp(overrides: Partial<OfflineOperation> = {}): OfflineOperation {
  return {
    operationId: 'op-1',
    profileId: 'profile-a',
    operationType: 'create_personal_task',
    entityId: null,
    clientGeneratedId: 'client-1',
    payload: { title: 'Buy milk' },
    expectedUpdatedAt: null,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: 'pending',
    lastSafeErrorCode: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: null, operations: [], isReplaying: false });
});

describe('useOfflineQueueStore', () => {
  it('hydrates an empty queue for a profile with nothing persisted', async () => {
    await useOfflineQueueStore.getState().hydrate('profile-a');
    expect(useOfflineQueueStore.getState().operations).toEqual([]);
    expect(useOfflineQueueStore.getState().profileId).toBe('profile-a');
  });

  it('enqueues an operation for the hydrated profile and persists it', async () => {
    await useOfflineQueueStore.getState().hydrate('profile-a');
    const result = await useOfflineQueueStore.getState().enqueue(fakeOp());
    expect(result).toEqual({ ok: true });
    expect(useOfflineQueueStore.getState().operations).toHaveLength(1);

    // A fresh store instance (simulating app restart) still finds it.
    useOfflineQueueStore.setState({ profileId: null, operations: [] });
    await useOfflineQueueStore.getState().hydrate('profile-a');
    expect(useOfflineQueueStore.getState().operations).toHaveLength(1);
  });

  it("refuses to enqueue an operation for a profile other than the hydrated one (never another account's op)", async () => {
    await useOfflineQueueStore.getState().hydrate('profile-a');
    const result = await useOfflineQueueStore.getState().enqueue(fakeOp({ profileId: 'profile-b' }));
    expect(result).toEqual({ ok: false, reason: 'queue_full' });
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
  });

  it('rejects enqueue once the bounded queue size is reached — never silently drops', async () => {
    await useOfflineQueueStore.getState().hydrate('profile-a');
    for (let i = 0; i < MAX_OFFLINE_QUEUE_SIZE; i++) {
      const result = await useOfflineQueueStore
        .getState()
        .enqueue(fakeOp({ operationId: `op-${i}` }));
      expect(result).toEqual({ ok: true });
    }
    const overflow = await useOfflineQueueStore.getState().enqueue(fakeOp({ operationId: 'op-overflow' }));
    expect(overflow).toEqual({ ok: false, reason: 'queue_full' });
    expect(useOfflineQueueStore.getState().operations).toHaveLength(MAX_OFFLINE_QUEUE_SIZE);
  });

  it('updateOperation patches exactly one operation by id', async () => {
    await useOfflineQueueStore.getState().hydrate('profile-a');
    await useOfflineQueueStore.getState().enqueue(fakeOp({ operationId: 'op-1' }));
    await useOfflineQueueStore.getState().enqueue(fakeOp({ operationId: 'op-2' }));

    await useOfflineQueueStore.getState().updateOperation('op-1', { status: 'conflict', lastSafeErrorCode: 'conflict' });

    const ops = useOfflineQueueStore.getState().operations;
    expect(ops.find((op) => op.operationId === 'op-1')?.status).toBe('conflict');
    expect(ops.find((op) => op.operationId === 'op-2')?.status).toBe('pending');
  });

  it('removeOperation removes exactly one operation by id', async () => {
    await useOfflineQueueStore.getState().hydrate('profile-a');
    await useOfflineQueueStore.getState().enqueue(fakeOp({ operationId: 'op-1' }));
    await useOfflineQueueStore.getState().enqueue(fakeOp({ operationId: 'op-2' }));

    await useOfflineQueueStore.getState().removeOperation('op-1');

    expect(useOfflineQueueStore.getState().operations.map((op) => op.operationId)).toEqual(['op-2']);
  });

  it("resets a leftover 'syncing' operation back to 'retry_wait' on hydrate (a crash mid-replay never strands an op)", async () => {
    await useOfflineQueueStore.getState().hydrate('profile-a');
    await useOfflineQueueStore.getState().enqueue(fakeOp({ operationId: 'op-1' }));
    await useOfflineQueueStore.getState().updateOperation('op-1', { status: 'syncing' });

    // Simulate an app relaunch: fresh store, re-hydrate from disk.
    useOfflineQueueStore.setState({ profileId: null, operations: [] });
    await useOfflineQueueStore.getState().hydrate('profile-a');

    expect(useOfflineQueueStore.getState().operations[0]?.status).toBe('retry_wait');
  });

  it("remapClientGeneratedId rewrites every op referencing a not-yet-synced task's clientGeneratedId to its real server id", async () => {
    await useOfflineQueueStore.getState().hydrate('profile-a');
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({ operationId: 'op-create', clientGeneratedId: 'client-1', entityId: null }),
    );
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({
        operationId: 'op-complete',
        operationType: 'complete_personal_task',
        entityId: 'client-1',
        clientGeneratedId: null,
      }),
    );

    await useOfflineQueueStore.getState().remapClientGeneratedId('client-1', 'server-task-1');

    const ops = useOfflineQueueStore.getState().operations;
    expect(ops.find((op) => op.operationId === 'op-complete')?.entityId).toBe('server-task-1');
    // The create op's own entityId was never 'client-1' (it's null pre-sync) — untouched.
    expect(ops.find((op) => op.operationId === 'op-create')?.entityId).toBeNull();
  });

  it('reset clears both memory and the persisted entry for that profile', async () => {
    await useOfflineQueueStore.getState().hydrate('profile-a');
    await useOfflineQueueStore.getState().enqueue(fakeOp());

    await useOfflineQueueStore.getState().reset();

    expect(useOfflineQueueStore.getState().operations).toEqual([]);
    expect(useOfflineQueueStore.getState().profileId).toBeNull();

    await useOfflineQueueStore.getState().hydrate('profile-a');
    expect(useOfflineQueueStore.getState().operations).toEqual([]);
  });
});

describe('selectors', () => {
  it('selectIsTaskPendingSync matches by entityId or clientGeneratedId', () => {
    const state = {
      operations: [fakeOp({ entityId: 'task-1', clientGeneratedId: null })],
    } as ReturnType<typeof useOfflineQueueStore.getState>;
    expect(selectIsTaskPendingSync(state, 'task-1')).toBe(true);
    expect(selectIsTaskPendingSync(state, 'client-1')).toBe(false);
    expect(selectIsTaskPendingSync(state, 'unrelated')).toBe(false);
  });

  it('selectPendingOperationCount counts pending/syncing only — never a sync issue, and never retry_wait (which counts as a sync issue instead)', () => {
    const state = {
      operations: [
        fakeOp({ operationId: 'a', status: 'pending' }),
        fakeOp({ operationId: 'b', status: 'retry_wait' }),
        fakeOp({ operationId: 'c', status: 'syncing' }),
        fakeOp({ operationId: 'd', status: 'conflict' }),
        fakeOp({ operationId: 'e', status: 'permanent_failure' }),
      ],
    } as ReturnType<typeof useOfflineQueueStore.getState>;
    expect(selectPendingOperationCount(state)).toBe(2);
  });

  it('selectSyncIssues returns retry_wait/conflict/permanent_failure operations (never pending/syncing), oldest first', () => {
    const state = {
      operations: [
        fakeOp({ operationId: 'newer', status: 'conflict', createdAt: '2026-01-03T00:00:00.000Z' }),
        fakeOp({ operationId: 'pending', status: 'pending' }),
        fakeOp({ operationId: 'syncing', status: 'syncing' }),
        fakeOp({ operationId: 'middle', status: 'retry_wait', createdAt: '2026-01-02T00:00:00.000Z' }),
        fakeOp({ operationId: 'older', status: 'permanent_failure', createdAt: '2026-01-01T00:00:00.000Z' }),
      ],
    } as ReturnType<typeof useOfflineQueueStore.getState>;
    expect(selectSyncIssues(state).map((op) => op.operationId)).toEqual(['older', 'middle', 'newer']);
    expect(selectSyncIssueCount(state)).toBe(3);
  });

  it('selectHasFailedOperations is true only when at least one operation is a sync issue', () => {
    const clean = { operations: [fakeOp({ status: 'pending' })] } as ReturnType<
      typeof useOfflineQueueStore.getState
    >;
    const dirty = { operations: [fakeOp({ status: 'conflict' })] } as ReturnType<
      typeof useOfflineQueueStore.getState
    >;
    expect(selectHasFailedOperations(clean)).toBe(false);
    expect(selectHasFailedOperations(dirty)).toBe(true);
  });

  it('selectOperationById finds exactly one operation by id, or undefined', () => {
    const state = {
      operations: [fakeOp({ operationId: 'a' }), fakeOp({ operationId: 'b' })],
    } as ReturnType<typeof useOfflineQueueStore.getState>;
    expect(selectOperationById(state, 'b')?.operationId).toBe('b');
    expect(selectOperationById(state, 'missing')).toBeUndefined();
  });
});
