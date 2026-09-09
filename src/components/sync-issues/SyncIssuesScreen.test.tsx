import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import { useOfflineQueueStore } from '@/lib/offline/offlineQueueStore';
import type { OfflineOperation } from '@/lib/offline/types';
import { AppThemeProvider } from '@/theme';

// Same reasoning as src/components/calendar/CalendarScreen.test.tsx for why
// this test file lives outside app/ — see that file's own comment.
import SyncIssuesScreen from '../../../app/sync-issues/index';

initI18n();

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let mockIsConnected = true;
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: mockIsConnected }),
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

const mockRetryOfflineQueue = jest.fn();
jest.mock('@/lib/offline/useOfflineQueueSync', () => ({
  retryOfflineQueue: () => mockRetryOfflineQueue(),
}));

const mockDiscardSyncIssue = jest.fn();
const mockRetrySyncIssue = jest.fn();
jest.mock('@/lib/offline/syncIssueResolution', () => ({
  discardSyncIssue: (...args: unknown[]) => mockDiscardSyncIssue(...args),
  retrySyncIssue: (...args: unknown[]) => mockRetrySyncIssue(...args),
}));

function fakeOp(overrides: Partial<OfflineOperation> = {}): OfflineOperation {
  return {
    operationId: 'op-1',
    profileId: 'profile-a',
    operationType: 'update_personal_task',
    entityId: 'task-1',
    clientGeneratedId: null,
    payload: { title: 'Buy milk' },
    expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    attemptCount: 1,
    status: 'retry_wait',
    lastSafeErrorCode: null,
    ...overrides,
  };
}

async function renderScreen(operations: OfflineOperation[] = []) {
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: 'profile-a', operations, isReplaying: false });
  return render(
    <AppThemeProvider>
      <SyncIssuesScreen />
    </AppThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConnected = true;
});

describe('SyncIssuesScreen', () => {
  it('shows the empty state ("Everything is synced") when there are no sync issues', async () => {
    await renderScreen([]);
    expect(screen.getByText('Everything is synced')).toBeTruthy();
    expect(screen.getByText('There are no changes requiring your attention.')).toBeTruthy();
  });

  it('renders a card per unresolved issue, oldest first', async () => {
    await renderScreen([
      fakeOp({ operationId: 'newer', createdAt: '2026-01-05T00:00:00.000Z', payload: { title: 'Newer task' } }),
      fakeOp({ operationId: 'older', createdAt: '2026-01-01T00:00:00.000Z', payload: { title: 'Older task' } }),
    ]);
    expect(screen.getByTestId('sync-issue-card-older')).toBeTruthy();
    expect(screen.getByTestId('sync-issue-card-newer')).toBeTruthy();
    expect(screen.getByText('Older task')).toBeTruthy();
    expect(screen.getByText('Newer task')).toBeTruthy();
  });

  it('shows a transient failure card', async () => {
    await renderScreen([fakeOp({ status: 'retry_wait' })]);
    expect(screen.getByText('Waiting to retry')).toBeTruthy();
  });

  it('shows a stale-write conflict card', async () => {
    await renderScreen([fakeOp({ status: 'conflict', lastSafeErrorCode: 'conflict' })]);
    expect(screen.getByText('Needs review')).toBeTruthy();
  });

  it('shows a permanent-failure card', async () => {
    await renderScreen([
      fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'permanent_validation' }),
    ]);
    expect(screen.getByText('Cannot be synchronized')).toBeTruthy();
  });

  it('shows a deleted-entity card', async () => {
    await renderScreen([fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'entity_deleted' })]);
    expect(screen.getByText('Task no longer available')).toBeTruthy();
  });

  it('shows an authorization-loss card with only Discard local change', async () => {
    await renderScreen([fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'authorization_lost' })]);
    expect(screen.getByText('Cannot be synchronized')).toBeTruthy();
    expect(screen.getByText('Discard local change')).toBeTruthy();
  });

  it('shows the offline note while offline, never while online', async () => {
    mockIsConnected = false;
    await renderScreen([fakeOp()]);
    expect(screen.getByTestId('sync-issues-offline-note')).toBeTruthy();
  });

  it('never shows the offline note while online', async () => {
    await renderScreen([fakeOp()]);
    expect(screen.queryByTestId('sync-issues-offline-note')).toBeNull();
  });

  it('never renders a raw Postgres error code or SQL identifier anywhere on the list', async () => {
    await renderScreen([
      fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'permanent_validation' }),
      fakeOp({ operationId: 'op-2', status: 'conflict', lastSafeErrorCode: 'conflict' }),
    ]);
    expect(screen.queryByText(/P0002|42501|SQLSTATE|relation ".*" does not exist/i)).toBeNull();
  });

  it('confirms before discarding, and calls discardSyncIssue with the right operationId on confirm', async () => {
    await renderScreen([fakeOp({ status: 'retry_wait', operationId: 'op-9' })]);
    await fireEvent.press(screen.getByTestId('sync-issue-discard-op-9'));
    expect(screen.getByText('Discard your offline change?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm'));
    await waitFor(() => expect(mockDiscardSyncIssue).toHaveBeenCalledWith('op-9'));
  });

  it('does not call discardSyncIssue when the confirmation dialog is cancelled', async () => {
    await renderScreen([fakeOp({ status: 'retry_wait', operationId: 'op-9' })]);
    await fireEvent.press(screen.getByTestId('sync-issue-discard-op-9'));
    await fireEvent.press(screen.getByText('Cancel'));
    expect(mockDiscardSyncIssue).not.toHaveBeenCalled();
  });

  it('calls retrySyncIssue with the right operationId when Retry is pressed', async () => {
    await renderScreen([fakeOp({ status: 'retry_wait', operationId: 'op-9' })]);
    await fireEvent.press(screen.getByTestId('sync-issue-retry-op-9'));
    await waitFor(() => expect(mockRetrySyncIssue).toHaveBeenCalledWith('op-9'));
  });

  it('pull-to-refresh triggers a manual queue retry pass', async () => {
    await renderScreen([fakeOp()]);
    const scrollView = screen.getByTestId('sync-issues-scroll');
    const { onRefresh } = scrollView.props.refreshControl.props;
    onRefresh();
    await waitFor(() => expect(mockRetryOfflineQueue).toHaveBeenCalled());
  });
});
