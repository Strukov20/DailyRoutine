import { getAvailableActions, getSyncIssueStatusLabel, isTerminalStatus } from './syncIssueDisplay';
import type { OfflineOperation } from './types';

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

describe('getSyncIssueStatusLabel', () => {
  it("maps 'retry_wait' to 'waitingToRetry'", () => {
    expect(getSyncIssueStatusLabel(fakeOp({ status: 'retry_wait' }))).toBe('waitingToRetry');
  });

  it("maps 'conflict' to 'needsReview'", () => {
    expect(getSyncIssueStatusLabel(fakeOp({ status: 'conflict', lastSafeErrorCode: 'conflict' }))).toBe(
      'needsReview',
    );
  });

  it("maps a 'permanent_failure' with 'task_unavailable' (the one merged outcome for gone/foreign/invisible) to 'taskGone'", () => {
    expect(
      getSyncIssueStatusLabel(fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'task_unavailable' })),
    ).toBe('taskGone');
  });

  it("maps every other 'permanent_failure' reason to 'cannotSync'", () => {
    expect(
      getSyncIssueStatusLabel(fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'permanent_validation' })),
    ).toBe('cannotSync');
    expect(getSyncIssueStatusLabel(fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'unknown' }))).toBe(
      'cannotSync',
    );
  });
});

describe('getAvailableActions', () => {
  it('offers Retry / Review pending change / Discard my change for a transient (retry_wait) failure', () => {
    expect(getAvailableActions(fakeOp({ status: 'retry_wait' }))).toEqual([
      'retry',
      'reviewPendingChange',
      'discardMyChange',
    ]);
  });

  it('offers only Review changes / Reload latest server version for a stale-write conflict — never a bare Retry', () => {
    const actions = getAvailableActions(fakeOp({ status: 'conflict', lastSafeErrorCode: 'conflict' }));
    expect(actions).toEqual(['reviewChanges', 'reloadLatestVersion']);
    expect(actions).not.toContain('retry');
  });

  it('offers Review pending change / Discard my change for a permanent validation failure — never Retry', () => {
    const actions = getAvailableActions(
      fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'permanent_validation' }),
    );
    expect(actions).toEqual(['reviewPendingChange', 'discardMyChange']);
    expect(actions).not.toContain('retry');
  });

  it('offers only Discard local change for the merged "task unavailable" outcome (gone, foreign, or no longer visible — indistinguishable) — no "create as new" action', () => {
    const actions = getAvailableActions(fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'task_unavailable' }));
    expect(actions).toEqual(['discardLocalChange']);
    expect(actions).not.toContain('reviewPendingChange');
  });

  it('offers the transient action set for a permanent_failure whose reason is "unknown" (exhausted retries)', () => {
    expect(getAvailableActions(fakeOp({ status: 'permanent_failure', lastSafeErrorCode: 'unknown' }))).toEqual([
      'retry',
      'reviewPendingChange',
      'discardMyChange',
    ]);
  });

  it('offers no actions once the operation is a terminal/non-issue status', () => {
    expect(getAvailableActions(fakeOp({ status: 'pending' }))).toEqual([]);
    expect(getAvailableActions(fakeOp({ status: 'discarded' }))).toEqual([]);
  });
});

describe('isTerminalStatus', () => {
  it('is true only for discarded', () => {
    expect(isTerminalStatus('discarded')).toBe(true);
    expect(isTerminalStatus('conflict')).toBe(false);
    expect(isTerminalStatus('permanent_failure')).toBe(false);
    expect(isTerminalStatus('retry_wait')).toBe(false);
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('syncing')).toBe(false);
  });
});
