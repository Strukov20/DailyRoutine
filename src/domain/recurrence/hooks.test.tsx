import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { useOfflineQueueStore } from '@/lib/offline/offlineQueueStore';
import { completeOccurrence, restoreOccurrence } from '@/lib/recurrence/recurrenceService';

import { useCompleteOccurrence, useRestoreOccurrence } from './hooks';

// Phase 9 — hooks.ts now pulls in the offline queue store, which pulls in
// AsyncStorage; same convention as src/domain/tasks/hooks.test.tsx.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let mockIsConnected = true;
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: mockIsConnected }),
}));

class MockRecurrenceServiceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RecurrenceServiceError';
    this.code = code;
  }
}

// Manual factory, not a bare jest.mock — automock still evaluates the real
// module, which imports the real Supabase client's AsyncStorage native
// module. Mirrors src/domain/tasks/hooks.test.tsx's own established fix.
jest.mock('@/lib/recurrence/recurrenceService', () => ({
  completeOccurrence: jest.fn(),
  restoreOccurrence: jest.fn(),
  RecurrenceServiceError: MockRecurrenceServiceError,
}));

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'u1' },
    session: null,
    status: 'signed-in',
    refreshProfile: jest.fn(),
  }),
}));

function makeWrapper(client: QueryClient) {
  // eslint-disable-next-line react/display-name -- test-only wrapper
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockIsConnected = true;
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: null, operations: [], isReplaying: false });
  await useOfflineQueueStore.getState().hydrate('u1');
});

describe('Phase 9 — offline queueing for recurring occurrences', () => {
  it('useCompleteOccurrence enqueues (never calls the RPC) while offline', async () => {
    mockIsConnected = false;
    const client = new QueryClient();

    const { result } = await renderHook(() => useCompleteOccurrence(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate('occ-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(completeOccurrence).not.toHaveBeenCalled();
    expect(useOfflineQueueStore.getState().operations).toHaveLength(1);
    expect(useOfflineQueueStore.getState().operations[0]).toMatchObject({
      operationType: 'complete_task_occurrence',
      entityId: 'occ-1',
    });
  });

  it('useCompleteOccurrence still calls the real RPC while online', async () => {
    (completeOccurrence as jest.Mock).mockResolvedValue(undefined);
    const client = new QueryClient();

    const { result } = await renderHook(() => useCompleteOccurrence(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate('occ-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(completeOccurrence).toHaveBeenCalledWith('occ-1');
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
  });

  it('useRestoreOccurrence enqueues (never calls the RPC) while offline', async () => {
    mockIsConnected = false;
    const client = new QueryClient();

    const { result } = await renderHook(() => useRestoreOccurrence(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate('occ-1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(restoreOccurrence).not.toHaveBeenCalled();
    expect(useOfflineQueueStore.getState().operations).toHaveLength(1);
    expect(useOfflineQueueStore.getState().operations[0]).toMatchObject({
      operationType: 'restore_task_occurrence',
      entityId: 'occ-1',
    });
  });

  it('surfaces a full offline queue as a mutation error, never a silently dropped operation', async () => {
    mockIsConnected = false;
    useOfflineQueueStore.setState({
      operations: Array.from({ length: 200 }, (_, i) => ({
        operationId: `existing-${i}`,
        profileId: 'u1',
        operationType: 'complete_task_occurrence' as const,
        entityId: `occ-${i}`,
        clientGeneratedId: null,
        payload: {},
        expectedUpdatedAt: null,
        reviewedVersion: null,
        createdAt: new Date().toISOString(),
        attemptCount: 0,
        status: 'pending' as const,
        lastSafeErrorCode: null,
      })),
    });
    const client = new QueryClient();

    const { result } = await renderHook(() => useCompleteOccurrence(), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.mutate('occ-overflow');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
