import type { OfflineOperation, OfflineOperationStatus } from './types';

/** Section 2's own four statuses, exactly. */
export type SyncIssueStatusLabel = 'waitingToRetry' | 'needsReview' | 'cannotSync' | 'taskGone';

export function getSyncIssueStatusLabel(operation: OfflineOperation): SyncIssueStatusLabel {
  if (operation.status === 'retry_wait') return 'waitingToRetry';
  if (operation.status === 'conflict') return 'needsReview';
  if (operation.lastSafeErrorCode === 'task_unavailable') return 'taskGone';
  return 'cannotSync';
}

export type SyncIssueAction =
  | 'retry'
  | 'reviewPendingChange'
  | 'reviewChanges'
  | 'discardMyChange'
  | 'discardLocalChange'
  | 'reloadLatestVersion'
  | 'applyMyChange';

/**
 * Section 3 — the exact action set per issue type. A stale-write conflict
 * deliberately never gets a bare Retry here ("Do not expose a generic
 * Retry action before the user chooses a resolution") — only Review
 * changes / Reload latest version; Apply/Keep live on the comparison
 * screen itself, reached through Review. A permanent validation failure
 * never gets Retry either ("the same payload can never succeed"). Final
 * security pass — 'task_unavailable' is the one merged outcome for "gone,"
 * "not yours," and "no longer visible," all deliberately indistinguishable
 * at the RPC layer (see docs/DECISIONS.md, "Phase 9"); Discard local
 * change is the only safe action regardless of which of those three it
 * actually was.
 */
export function getAvailableActions(operation: OfflineOperation): SyncIssueAction[] {
  switch (operation.status) {
    case 'retry_wait':
      return ['retry', 'reviewPendingChange', 'discardMyChange'];
    case 'conflict':
      return ['reviewChanges', 'reloadLatestVersion'];
    case 'permanent_failure':
      switch (operation.lastSafeErrorCode) {
        case 'permanent_validation':
          return ['reviewPendingChange', 'discardMyChange'];
        case 'task_unavailable':
          return ['discardLocalChange'];
        case 'unknown':
        default:
          // A transient failure that exhausted its retry budget — still
          // "transient" in kind, so the same action set as retry_wait.
          return ['retry', 'reviewPendingChange', 'discardMyChange'];
      }
    default:
      return [];
  }
}

/** A queued create has no server entity yet — a title from the local patch itself is always safe to show (it's this device's own not-yet-sent value, never another user's content). */
export function getSafeIssueTitleFallbackKey(operationType: OfflineOperation['operationType']): string {
  return `syncIssues:operationType.${operationType}`;
}

export function isTerminalStatus(status: OfflineOperationStatus): boolean {
  return status === 'discarded';
}
