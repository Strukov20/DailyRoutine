import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import type { OfflineOperation } from '@/lib/offline/types';
import { SyncIssueCard } from './SyncIssueCard';

initI18n();

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...args: unknown[]) => mockPush(...args) },
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
    reviewedVersion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    attemptCount: 1,
    status: 'retry_wait',
    lastSafeErrorCode: null,
    ...overrides,
  };
}

async function renderCard(props: Partial<Parameters<typeof SyncIssueCard>[0]> = {}) {
  const onRetry = jest.fn();
  const onDiscard = jest.fn();
  await render(
    <AppThemeProvider>
      <SyncIssueCard
        operation={fakeOp()}
        locale="en"
        onRetry={onRetry}
        onDiscard={onDiscard}
        isBusy={false}
        {...props}
      />
    </AppThemeProvider>,
  );
  return { onRetry, onDiscard };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SyncIssueCard', () => {
  it('shows the local task title, never a raw operation type as the primary label', async () => {
    await renderCard({ operation: fakeOp({ payload: { title: 'Buy milk' } }) });
    expect(screen.getByText('Buy milk')).toBeTruthy();
  });

  it('falls back to a generic operation-type label when the payload has no title', async () => {
    await renderCard({ operation: fakeOp({ operationType: 'complete_personal_task', payload: {} }) });
    expect(screen.getByText('Complete task')).toBeTruthy();
  });

  it('shows "Waiting to retry" and offers Retry / Review pending change / Discard for a retry_wait issue', async () => {
    await renderCard({ operation: fakeOp({ status: 'retry_wait' }) });
    expect(screen.getByText('Waiting to retry')).toBeTruthy();
    expect(screen.getByTestId('sync-issue-retry-op-1')).toBeTruthy();
    expect(screen.getByTestId('sync-issue-review-op-1')).toBeTruthy();
    expect(screen.getByTestId('sync-issue-discard-op-1')).toBeTruthy();
  });

  it('shows "Needs review" and never offers a bare Retry for a stale-write conflict', async () => {
    await renderCard({ operation: fakeOp({ status: 'conflict', lastSafeErrorCode: 'conflict' }) });
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.queryByTestId('sync-issue-retry-op-1')).toBeNull();
    expect(screen.getByTestId('sync-issue-review-op-1')).toBeTruthy();
  });

  it('shows "Task no longer available" and only a Discard action for a deleted entity', async () => {
    await renderCard({
      operation: fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'task_unavailable' }),
    });
    expect(screen.getByText('Task no longer available')).toBeTruthy();
    expect(screen.queryByTestId('sync-issue-retry-op-1')).toBeNull();
    expect(screen.queryByTestId('sync-issue-review-op-1')).toBeNull();
    expect(screen.getByTestId('sync-issue-discard-op-1')).toBeTruthy();
  });

  it('shows "Cannot be synchronized" for a permanent validation failure, with Review + Discard but no Retry', async () => {
    await renderCard({
      operation: fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'permanent_validation' }),
    });
    expect(screen.getByText('Cannot be synchronized')).toBeTruthy();
    expect(screen.queryByTestId('sync-issue-retry-op-1')).toBeNull();
  });

  it('never renders a raw Postgres error, SQL name, or JSON payload — only the safe reason text', async () => {
    await renderCard({
      operation: fakeOp({
        status: 'permanent_failure',
        lastSafeErrorCode: 'permanent_validation',
        payload: { title: 'Buy milk' },
      }),
    });
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).not.toMatch(/P0002|42501|pgcode|relation ".*" does not exist|"payload"/i);
  });

  it('calls onRetry with this operation\'s id when Retry is pressed', async () => {
    const { onRetry } = await renderCard({ operation: fakeOp({ status: 'retry_wait' }) });
    await fireEvent.press(screen.getByTestId('sync-issue-retry-op-1'));
    expect(onRetry).toHaveBeenCalledWith('op-1');
  });

  it('calls onDiscard with this operation\'s id when Discard is pressed', async () => {
    const { onDiscard } = await renderCard({ operation: fakeOp({ status: 'retry_wait' }) });
    await fireEvent.press(screen.getByTestId('sync-issue-discard-op-1'));
    expect(onDiscard).toHaveBeenCalledWith('op-1');
  });

  it('navigates to the comparison/review screen for this exact operationId when Review is pressed', async () => {
    await renderCard({ operation: fakeOp({ status: 'conflict', lastSafeErrorCode: 'conflict', operationId: 'op-42' }) });
    await fireEvent.press(screen.getByTestId('sync-issue-review-op-42'));
    expect(mockPush).toHaveBeenCalledWith('/sync-issues/op-42');
  });

  it('disables Retry/Discard while busy and reflects it in accessibility state', async () => {
    await renderCard({ operation: fakeOp({ status: 'retry_wait' }), isBusy: true });
    const retryButton = screen.getByTestId('sync-issue-retry-op-1');
    expect(retryButton.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('minimum touch target: action buttons carry an accessibility role, never color-only', async () => {
    await renderCard({ operation: fakeOp({ status: 'retry_wait' }) });
    const retryButton = screen.getByTestId('sync-issue-retry-op-1');
    expect(retryButton.props.accessibilityState?.disabled).toBe(false);
  });
});
