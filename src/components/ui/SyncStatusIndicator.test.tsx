import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import { useOfflineQueueStore } from '@/lib/offline/offlineQueueStore';
import { retryOfflineQueue } from '@/lib/offline/useOfflineQueueSync';
import { useUIStore } from '@/store/uiStore';
import { AppThemeProvider } from '@/theme';

import { resolveSyncDisplayState, SyncStatusIndicator } from './SyncStatusIndicator';

initI18n();

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let mockIsConnected = true;
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: mockIsConnected }),
}));

jest.mock('@/lib/offline/useOfflineQueueSync', () => ({
  retryOfflineQueue: jest.fn(),
}));

async function renderIndicator() {
  return render(
    <AppThemeProvider>
      <SyncStatusIndicator />
    </AppThemeProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockIsConnected = true;
  useUIStore.setState({ realtimeStatus: 'connected' });
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: 'u1', operations: [], isReplaying: false });
});

describe('resolveSyncDisplayState', () => {
  it('a failed operation always wins, even while offline with more pending', () => {
    expect(
      resolveSyncDisplayState({
        isOffline: true,
        hasFailedOperations: true,
        pendingCount: 3,
        isReplaying: false,
        realtimeStatus: 'connected',
      }),
    ).toBe('sync-issue');
  });

  it('offline with nothing pending is "offline" (deferred to OfflineBanner)', () => {
    expect(
      resolveSyncDisplayState({
        isOffline: true,
        hasFailedOperations: false,
        pendingCount: 0,
        isReplaying: false,
        realtimeStatus: 'offline',
      }),
    ).toBe('offline');
  });

  it('offline with pending operations is "pending", not "offline"', () => {
    expect(
      resolveSyncDisplayState({
        isOffline: true,
        hasFailedOperations: false,
        pendingCount: 1,
        isReplaying: false,
        realtimeStatus: 'offline',
      }),
    ).toBe('pending');
  });

  it('online and actively replaying is "syncing"', () => {
    expect(
      resolveSyncDisplayState({
        isOffline: false,
        hasFailedOperations: false,
        pendingCount: 1,
        isReplaying: true,
        realtimeStatus: 'connected',
      }),
    ).toBe('syncing');
  });

  it('online with pending but not yet replaying is "pending"', () => {
    expect(
      resolveSyncDisplayState({
        isOffline: false,
        hasFailedOperations: false,
        pendingCount: 2,
        isReplaying: false,
        realtimeStatus: 'connected',
      }),
    ).toBe('pending');
  });

  it('a reconnecting Realtime channel with nothing queued is "syncing"', () => {
    expect(
      resolveSyncDisplayState({
        isOffline: false,
        hasFailedOperations: false,
        pendingCount: 0,
        isReplaying: false,
        realtimeStatus: 'reconnecting',
      }),
    ).toBe('syncing');
  });

  it('nothing pending, nothing failed, connected — "synced"', () => {
    expect(
      resolveSyncDisplayState({
        isOffline: false,
        hasFailedOperations: false,
        pendingCount: 0,
        isReplaying: false,
        realtimeStatus: 'connected',
      }),
    ).toBe('synced');
  });
});

describe('SyncStatusIndicator', () => {
  it('shows "Synced" by default', async () => {
    await renderIndicator();
    expect(screen.getByText('Synced')).toBeTruthy();
  });

  it('renders nothing extra while offline with nothing pending (OfflineBanner already covers it)', async () => {
    mockIsConnected = false;
    await renderIndicator();
    expect(screen.queryByText('Synced')).toBeNull();
    expect(screen.queryByText(/Sync issue/)).toBeNull();
  });

  it('shows a pluralized pending-changes count', async () => {
    useOfflineQueueStore.setState({
      operations: [
        {
          operationId: 'op-1',
          profileId: 'u1',
          operationType: 'complete_personal_task',
          entityId: 't1',
          clientGeneratedId: null,
          payload: {},
          expectedUpdatedAt: null,
          createdAt: new Date().toISOString(),
          attemptCount: 0,
          status: 'pending',
          lastSafeErrorCode: null,
        },
      ],
    });
    await renderIndicator();
    expect(screen.getByText('1 change pending')).toBeTruthy();
  });

  it('shows "Sync issue" with a working Retry action when an operation has permanently failed', async () => {
    useOfflineQueueStore.setState({
      operations: [
        {
          operationId: 'op-1',
          profileId: 'u1',
          operationType: 'complete_personal_task',
          entityId: 't1',
          clientGeneratedId: null,
          payload: {},
          expectedUpdatedAt: null,
          createdAt: new Date().toISOString(),
          attemptCount: 5,
          status: 'failed',
          lastSafeErrorCode: 'unknown',
        },
      ],
    });
    await renderIndicator();
    expect(screen.getByText('Sync issue')).toBeTruthy();

    await fireEvent.press(screen.getByText('Try again'));
    expect(retryOfflineQueue).toHaveBeenCalledTimes(1);
  });
});
