import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { initI18n } from '@/i18n';
import { useOfflineQueueStore } from '@/lib/offline/offlineQueueStore';
import type { ConflictComparison } from '@/lib/offline/syncIssueResolution';
import type { OfflineOperation } from '@/lib/offline/types';
import { AppThemeProvider } from '@/theme';

// Same reasoning as src/components/calendar/CalendarScreen.test.tsx for why
// this test file lives outside app/ — see that file's own comment.
import SyncIssueDetailScreen from '../../../app/sync-issues/[operationId]';

initI18n();

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let mockIsConnected = true;
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: mockIsConnected }),
}));

let mockOperationId: string | undefined = 'op-1';
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { back: (...args: unknown[]) => mockBack(...args), push: jest.fn() },
  useLocalSearchParams: () => ({ operationId: mockOperationId }),
}));

const mockGetConflictComparison = jest.fn();
const mockGetLocalChangeFields = jest.fn();
const mockReloadServerSnapshot = jest.fn();
const mockDiscardSyncIssue = jest.fn();
const mockApplyMyChange = jest.fn();
const mockRetrySyncIssue = jest.fn();

jest.mock('@/lib/offline/syncIssueResolution', () => ({
  getConflictComparison: (...args: unknown[]) => mockGetConflictComparison(...args),
  getLocalChangeFields: (...args: unknown[]) => mockGetLocalChangeFields(...args),
  reloadServerSnapshot: (...args: unknown[]) => mockReloadServerSnapshot(...args),
  discardSyncIssue: (...args: unknown[]) => mockDiscardSyncIssue(...args),
  applyMyChange: (...args: unknown[]) => mockApplyMyChange(...args),
  retrySyncIssue: (...args: unknown[]) => mockRetrySyncIssue(...args),
}));

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

const CONFLICT_COMPARISON: ConflictComparison = {
  serverTask: { id: 'task-1', title: 'Server title' } as never,
  fields: [{ field: 'title', local: 'Local title', server: 'Server title' }],
};

async function renderScreen(operation: OfflineOperation | null) {
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({
    profileId: 'profile-a',
    operations: operation ? [operation] : [],
    isReplaying: false,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppThemeProvider>
        <SyncIssueDetailScreen />
      </AppThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConnected = true;
  mockOperationId = 'op-1';
  mockGetConflictComparison.mockResolvedValue(CONFLICT_COMPARISON);
  mockGetLocalChangeFields.mockReturnValue([{ field: 'title', local: 'Local title', server: null }]);
});

describe('SyncIssueDetailScreen', () => {
  it('shows a safe "not found" fallback for a stale deep link to an operation that no longer exists', async () => {
    await renderScreen(null);
    expect(screen.getByText('This issue is no longer available')).toBeTruthy();
  });

  it('shows the same safe fallback for a terminal (already-discarded) operation — never another account\'s content', async () => {
    await renderScreen(fakeOp({ status: 'discarded' }));
    expect(screen.getByText('This issue is no longer available')).toBeTruthy();
  });

  it('shows the same safe fallback when the route has no operationId at all', async () => {
    mockOperationId = undefined;
    await renderScreen(fakeOp());
    expect(screen.getByText('This issue is no longer available')).toBeTruthy();
  });

  it('renders the field-level comparison table for a stale-write conflict, only local/server headers and relevant fields', async () => {
    await renderScreen(fakeOp());
    await waitFor(() => expect(screen.getByTestId('sync-issue-comparison-table')).toBeTruthy());
    expect(screen.getByText('On this device')).toBeTruthy();
    expect(screen.getByText('Latest server version')).toBeTruthy();
    expect(screen.getByText('Local title')).toBeTruthy();
    expect(screen.getByText('Server title')).toBeTruthy();
  });

  it('shows only the local values (no server column) for a non-conflict issue — Review pending change', async () => {
    await renderScreen(fakeOp({ status: 'retry_wait', lastSafeErrorCode: null }));
    expect(screen.queryByTestId('sync-issue-comparison-table')).toBeNull();
    expect(screen.getByText('Local title')).toBeTruthy();
  });

  it('never renders raw server error details anywhere on the comparison screen', async () => {
    await renderScreen(fakeOp());
    await waitFor(() => expect(screen.getByTestId('sync-issue-comparison-table')).toBeTruthy());
    expect(screen.queryByText(/P0002|42501|SQLSTATE/i)).toBeNull();
  });

  it('Reload latest server version calls reloadServerSnapshot for this exact operationId', async () => {
    mockReloadServerSnapshot.mockResolvedValue(CONFLICT_COMPARISON);
    await renderScreen(fakeOp());
    await waitFor(() => expect(screen.getByTestId('sync-issue-comparison-table')).toBeTruthy());
    await fireEvent.press(screen.getByText('Reload latest server version'));
    await waitFor(() => expect(mockReloadServerSnapshot).toHaveBeenCalledWith('op-1'));
  });

  it('shows the entity-gone message when the comparison resolves with no server task (deleted or no longer authorized)', async () => {
    mockGetConflictComparison.mockResolvedValue({ serverTask: null, fields: [] });
    await renderScreen(fakeOp());
    await waitFor(() => expect(screen.getByText('This task no longer exists on the server.')).toBeTruthy());
  });

  it('marks the latest server version unavailable and disables Reload/Apply while offline — never claims a stale snapshot is current', async () => {
    mockIsConnected = false;
    await renderScreen(fakeOp());
    expect(screen.getByText('Latest server version unavailable — you\'re offline.')).toBeTruthy();
    expect(mockGetConflictComparison).not.toHaveBeenCalled();
    const reloadButton = screen.getByText('Reload latest server version');
    expect(reloadButton.parent?.parent?.props.accessibilityState?.disabled).toBe(true);
  });

  it('Discard (Keep server version) requires confirmation, then calls discardSyncIssue for this exact operationId and navigates back', async () => {
    await renderScreen(fakeOp({ status: 'retry_wait', lastSafeErrorCode: null }));
    await fireEvent.press(screen.getByText('Keep server version'));
    expect(screen.getByText('Discard your offline change?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm'));
    await waitFor(() => expect(mockDiscardSyncIssue).toHaveBeenCalledWith('op-1'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('cancelling the Discard confirmation never calls discardSyncIssue', async () => {
    await renderScreen(fakeOp({ status: 'retry_wait', lastSafeErrorCode: null }));
    await fireEvent.press(screen.getByText('Keep server version'));
    await fireEvent.press(screen.getByText('Cancel'));
    expect(mockDiscardSyncIssue).not.toHaveBeenCalled();
  });

  it('shows "Discard local change" (not "Keep server version") for an authorization-loss issue', async () => {
    await renderScreen(
      fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'authorization_lost' }),
    );
    expect(screen.getByText('Discard local change')).toBeTruthy();
    expect(screen.queryByText('Keep server version')).toBeNull();
  });

  it('Apply my change requires confirmation, then reapplies via applyMyChange for this exact operationId', async () => {
    mockApplyMyChange.mockResolvedValue({ result: 'succeeded' });
    await renderScreen(fakeOp());
    await waitFor(() => expect(screen.getByTestId('sync-issue-comparison-table')).toBeTruthy());
    await fireEvent.press(screen.getByText('Apply my change'));
    expect(screen.getByText('Apply your offline change?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm'));
    await waitFor(() => expect(mockApplyMyChange).toHaveBeenCalledWith('op-1'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('stays on screen (never silently navigates away) when Apply hits a renewed conflict', async () => {
    mockApplyMyChange.mockResolvedValue({ result: 'conflict' });
    await renderScreen(fakeOp());
    await waitFor(() => expect(screen.getByTestId('sync-issue-comparison-table')).toBeTruthy());
    await fireEvent.press(screen.getByText('Apply my change'));
    await fireEvent.press(screen.getByText('Confirm'));
    await waitFor(() => expect(mockApplyMyChange).toHaveBeenCalled());
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('disables Apply my change while offline', async () => {
    mockIsConnected = false;
    await renderScreen(fakeOp());
    const applyButton = screen.getByText('Apply my change');
    expect(applyButton.parent?.parent?.props.accessibilityState?.disabled).toBe(true);
  });

  it('Retry is offered (and calls retrySyncIssue) only for a retry_wait issue, never for a conflict', async () => {
    await renderScreen(fakeOp({ status: 'retry_wait', lastSafeErrorCode: null }));
    expect(screen.getByText('Retry')).toBeTruthy();
    await fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(mockRetrySyncIssue).toHaveBeenCalledWith('op-1'));
  });

  it('never offers Retry for a stale-write conflict', async () => {
    await renderScreen(fakeOp());
    expect(screen.queryByText('Retry')).toBeNull();
  });
});
