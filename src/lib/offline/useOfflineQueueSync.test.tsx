import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useOfflineQueueStore } from './offlineQueueStore';
import { retryOfflineQueue, useOfflineQueueSync } from './useOfflineQueueSync';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type AppStateChangeCallback = (state: string) => void;
let appStateCallback: AppStateChangeCallback | null = null;

let mockAuthStatus: 'loading' | 'signed-out' | 'signed-in' = 'signed-in';
let mockProfile: { id: string } | null = { id: 'profile-1' };
jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ status: mockAuthStatus, profile: mockProfile }),
}));

const mockCompletePersonalTask = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/tasks/taskService', () => {
  const actual = jest.requireActual('@/lib/tasks/taskService');
  return {
    ...actual,
    completePersonalTask: (...args: unknown[]) => mockCompletePersonalTask(...args),
  };
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockAuthStatus = 'signed-in';
  mockProfile = { id: 'profile-1' };
  appStateCallback = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    if (event === 'change') appStateCallback = callback as AppStateChangeCallback;
    return { remove: jest.fn() };
  });
  onlineManager.setOnline(true);
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: null, operations: [], isReplaying: false });
});

describe('useOfflineQueueSync', () => {
  it('hydrates the signed-in profile\'s queue and replays it once auth is ready', async () => {
    await useOfflineQueueStore.getState().hydrate('profile-1');
    await useOfflineQueueStore.getState().enqueue({
      operationId: 'op-1',
      profileId: 'profile-1',
      operationType: 'complete_personal_task',
      entityId: 'task-1',
      clientGeneratedId: null,
      payload: {},
      expectedUpdatedAt: null,
      reviewedVersion: null,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      status: 'pending',
      lastSafeErrorCode: null,
    });
    // Reset in-memory state to simulate a fresh app launch that still has
    // this profile's queue on disk — the hook itself must (re)hydrate it.
    useOfflineQueueStore.setState({ profileId: null, operations: [] });

    const { unmount } = await renderHook(() => useOfflineQueueSync());
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCompletePersonalTask).toHaveBeenCalledWith('task-1');
    await unmount();
  });

  it('resets the queue immediately on sign-out, never carrying it into the next account', async () => {
    await useOfflineQueueStore.getState().hydrate('profile-1');
    await useOfflineQueueStore.getState().enqueue({
      operationId: 'op-1',
      profileId: 'profile-1',
      operationType: 'complete_personal_task',
      entityId: 'task-1',
      clientGeneratedId: null,
      payload: {},
      expectedUpdatedAt: null,
      reviewedVersion: null,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      status: 'pending',
      lastSafeErrorCode: null,
    });

    const { rerender, unmount } = await renderHook(() => useOfflineQueueSync());

    mockAuthStatus = 'signed-out';
    mockProfile = null;
    await act(async () => {
      await rerender({});
    });

    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
    expect(useOfflineQueueStore.getState().profileId).toBeNull();
    await unmount();
  });

  it('replays on network reconnect', async () => {
    onlineManager.setOnline(false);
    await useOfflineQueueStore.getState().hydrate('profile-1');
    await useOfflineQueueStore.getState().enqueue({
      operationId: 'op-1',
      profileId: 'profile-1',
      operationType: 'complete_personal_task',
      entityId: 'task-1',
      clientGeneratedId: null,
      payload: {},
      expectedUpdatedAt: null,
      reviewedVersion: null,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      status: 'pending',
      lastSafeErrorCode: null,
    });

    const { unmount } = await renderHook(() => useOfflineQueueSync());
    expect(mockCompletePersonalTask).not.toHaveBeenCalled();

    await act(async () => {
      onlineManager.setOnline(true);
      await Promise.resolve();
    });

    expect(mockCompletePersonalTask).toHaveBeenCalledWith('task-1');
    await unmount();
  });

  it('replays when the app returns to the foreground', async () => {
    await useOfflineQueueStore.getState().hydrate('profile-1');
    const { unmount } = await renderHook(() => useOfflineQueueSync());
    await act(async () => {
      await Promise.resolve();
    });
    mockCompletePersonalTask.mockClear();

    await useOfflineQueueStore.getState().enqueue({
      operationId: 'op-2',
      profileId: 'profile-1',
      operationType: 'complete_personal_task',
      entityId: 'task-2',
      clientGeneratedId: null,
      payload: {},
      expectedUpdatedAt: null,
      reviewedVersion: null,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      status: 'pending',
      lastSafeErrorCode: null,
    });

    await act(async () => {
      appStateCallback?.('active');
      await Promise.resolve();
    });

    expect(mockCompletePersonalTask).toHaveBeenCalledWith('task-2');
    await unmount();
  });

  it('retryOfflineQueue replays pending operations on demand', async () => {
    onlineManager.setOnline(false);
    await useOfflineQueueStore.getState().hydrate('profile-1');
    await useOfflineQueueStore.getState().enqueue({
      operationId: 'op-1',
      profileId: 'profile-1',
      operationType: 'complete_personal_task',
      entityId: 'task-1',
      clientGeneratedId: null,
      payload: {},
      expectedUpdatedAt: null,
      reviewedVersion: null,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      status: 'pending',
      lastSafeErrorCode: null,
    });
    onlineManager.setOnline(true);

    retryOfflineQueue();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCompletePersonalTask).toHaveBeenCalledWith('task-1');
  });
});
