import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import { useOfflineQueueStore } from '@/lib/offline/offlineQueueStore';
import type { OfflineOperation } from '@/lib/offline/types';
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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

async function renderIndicator() {
  return render(
    <AppThemeProvider>
      <SyncStatusIndicator />
    </AppThemeProvider>,
  );
}

function fakeOp(overrides: Partial<OfflineOperation> = {}): OfflineOperation {
  return {
    operationId: 'op-1',
    profileId: 'u1',
    operationType: 'complete_personal_task',
    entityId: 't1',
    clientGeneratedId: null,
    payload: {},
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
  mockIsConnected = true;
  useUIStore.setState({ realtimeStatus: 'connected' });
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: 'u1', operations: [], isReplaying: false });
});

describe('resolveSyncDisplayState', () => {
  it('a sync issue always wins, even while offline with more pending', () => {
    expect(
      resolveSyncDisplayState({
        isOffline: true,
        hasSyncIssues: true,
        pendingCount: 3,
        isReplaying: false,
        realtimeStatus: 'connected',
      }),
    ).toBe('sync-issues');
  });

  it('offline with nothing pending is "offline" (deferred to OfflineBanner)', () => {
    expect(
      resolveSyncDisplayState({
        isOffline: true,
        hasSyncIssues: false,
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
        hasSyncIssues: false,
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
        hasSyncIssues: false,
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
        hasSyncIssues: false,
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
        hasSyncIssues: false,
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
        hasSyncIssues: false,
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
    useOfflineQueueStore.setState({ operations: [fakeOp({ status: 'pending' })] });
    await renderIndicator();
    expect(screen.getByText('1 change pending')).toBeTruthy();
  });

  it('shows "1 sync issue" and navigates to /sync-issues on tap, for a permanently-failed (non-conflict) operation', async () => {
    useOfflineQueueStore.setState({
      operations: [fakeOp({ attemptCount: 5, status: 'permanent_failure', lastSafeErrorCode: 'unknown' })],
    });
    await renderIndicator();
    expect(screen.getByText('1 sync issue')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('sync-issues-indicator'));
    expect(mockPush).toHaveBeenCalledWith('/sync-issues');
  });

  it('shows distinguishable "needs review" text when every sync issue is a conflict', async () => {
    useOfflineQueueStore.setState({
      operations: [fakeOp({ status: 'conflict', lastSafeErrorCode: 'conflict' })],
    });
    await renderIndicator();
    expect(screen.getByText('1 needs review')).toBeTruthy();
  });

  it('shows the generic "sync issues" text when issues are mixed (not all conflicts)', async () => {
    useOfflineQueueStore.setState({
      operations: [
        fakeOp({ operationId: 'op-1', status: 'conflict', lastSafeErrorCode: 'conflict' }),
        fakeOp({
          operationId: 'op-2',
          status: 'permanent_failure',
          lastSafeErrorCode: 'task_unavailable',
        }),
      ],
    });
    await renderIndicator();
    expect(screen.getByText('2 sync issues')).toBeTruthy();
  });
});
