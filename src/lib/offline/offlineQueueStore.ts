import { create } from 'zustand';

import { createLogger } from '@/lib/logger/logger';

import { clearQueue, loadQueue, saveQueue } from './offlineQueueStorage';
import { MAX_OFFLINE_QUEUE_SIZE, type OfflineOperation } from './types';

const logger = createLogger('offline-queue');

export type EnqueueResult = { ok: true } | { ok: false; reason: 'queue_full' };

interface OfflineQueueState {
  /** The profile this in-memory copy belongs to — never mixed across accounts (Section 12). */
  profileId: string | null;
  operations: OfflineOperation[];
  /** True while the replay worker is actively processing an op — the in-process lock (Section 12: "one replay worker at a time"). RN's single JS thread makes an in-memory flag sufficient; no cross-process lease is needed. */
  isReplaying: boolean;

  /** Loads this profile's persisted queue into memory — call once auth/profile is known (Section 12: "replay after auth restoration"). */
  hydrate: (profileId: string) => Promise<void>;
  enqueue: (operation: OfflineOperation) => Promise<EnqueueResult>;
  updateOperation: (operationId: string, patch: Partial<OfflineOperation>) => Promise<void>;
  removeOperation: (operationId: string) => Promise<void>;
  /**
   * Section 10 — "FIFO replay where dependencies require it." An offline
   * create is optimistically rendered under `clientGeneratedId`; any
   * later-queued op on that same not-yet-synced task (e.g. "complete the
   * task I just created") is enqueued referencing that same id as its
   * `entityId`, since the real server id isn't known yet. Once the create
   * replays successfully, this rewrites every such op to the real id
   * before they get their turn — never left pointing at an id the server
   * has never heard of.
   */
  remapClientGeneratedId: (clientGeneratedId: string, realEntityId: string) => Promise<void>;
  setReplaying: (replaying: boolean) => void;
  /** Section 12 — stop immediately on logout/account switch, never carry one account's queue into another's session. */
  reset: () => Promise<void>;
}

export const useOfflineQueueStore = create<OfflineQueueState>((set, get) => ({
  profileId: null,
  operations: [],
  isReplaying: false,

  hydrate: async (profileId: string) => {
    const loaded = await loadQueue(profileId);
    // Section 10: "process crash never loses accepted queued intent." An
    // operation left 'syncing' means the app died mid-replay with the
    // request's outcome unknown — never assumed lost *or* assumed done,
    // just retried; every queued RPC is idempotent (client_operation_id
    // for create, expected_updated_at precondition for update/schedule),
    // so re-attempting it is always safe.
    const operations = loaded.map((op) => (op.status === 'syncing' ? { ...op, status: 'retry_wait' as const } : op));
    // A stale hydrate from a profile the app has since switched away from
    // must never clobber the newer profile's already-hydrated state.
    if (get().profileId !== null && get().profileId !== profileId) return;
    set({ profileId, operations });
    if (operations.some((op, i) => op !== loaded[i])) await saveQueue(profileId, operations);
  },

  enqueue: async (operation: OfflineOperation) => {
    const { profileId, operations } = get();
    if (profileId !== operation.profileId) {
      logger.warn('refusing to enqueue an operation for a profile other than the hydrated one');
      return { ok: false, reason: 'queue_full' };
    }
    if (operations.length >= MAX_OFFLINE_QUEUE_SIZE) {
      return { ok: false, reason: 'queue_full' };
    }
    const next = [...operations, operation];
    set({ operations: next });
    await saveQueue(profileId, next);
    return { ok: true };
  },

  updateOperation: async (operationId: string, patch: Partial<OfflineOperation>) => {
    const { profileId, operations } = get();
    if (!profileId) return;
    const next = operations.map((op) => (op.operationId === operationId ? { ...op, ...patch } : op));
    set({ operations: next });
    await saveQueue(profileId, next);
  },

  removeOperation: async (operationId: string) => {
    const { profileId, operations } = get();
    if (!profileId) return;
    const next = operations.filter((op) => op.operationId !== operationId);
    set({ operations: next });
    await saveQueue(profileId, next);
  },

  remapClientGeneratedId: async (clientGeneratedId: string, realEntityId: string) => {
    const { profileId, operations } = get();
    if (!profileId) return;
    const next = operations.map((op) =>
      op.entityId === clientGeneratedId ? { ...op, entityId: realEntityId } : op,
    );
    set({ operations: next });
    await saveQueue(profileId, next);
  },

  setReplaying: (replaying: boolean) => set({ isReplaying: replaying }),

  reset: async () => {
    const { profileId } = get();
    set({ profileId: null, operations: [], isReplaying: false });
    if (profileId) await clearQueue(profileId);
  },
}));

/** True while any queued op (in any status — still-pending or needing review) targets this task (create's not-yet-real id or an existing task's real id). */
export function selectIsTaskPendingSync(state: OfflineQueueState, taskId: string): boolean {
  return state.operations.some((op) => op.entityId === taskId || op.clientGeneratedId === taskId);
}

/** "Pending changes: N" — freshly queued or actively in flight, never yet failed even once. */
export function selectPendingOperationCount(state: OfflineQueueState): number {
  return state.operations.filter((op) => op.status === 'pending' || op.status === 'syncing').length;
}

/**
 * Sync Issues — every operation that's had at least one failed attempt:
 * 'retry_wait' (Section 2's "Waiting to retry," still auto-retrying but
 * surfaced so the user can intervene early — Review/Discard/a forced
 * Retry), 'conflict' ("Needs review"), and 'permanent_failure' ("Cannot
 * be synchronized" / "Task no longer available"). Disjoint from
 * `selectPendingOperationCount` on purpose — an operation is never
 * counted in both at once. Oldest first, matching the Sync Issues list's
 * own ordering rule.
 */
export function selectSyncIssues(state: OfflineQueueState): OfflineOperation[] {
  return state.operations
    .filter((op) => op.status === 'retry_wait' || op.status === 'conflict' || op.status === 'permanent_failure')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function selectSyncIssueCount(state: OfflineQueueState): number {
  return selectSyncIssues(state).length;
}

/** Back-compat alias some call sites still read as a boolean gate. */
export function selectHasFailedOperations(state: OfflineQueueState): boolean {
  return selectSyncIssueCount(state) > 0;
}

export function selectOperationById(state: OfflineQueueState, operationId: string): OfflineOperation | undefined {
  return state.operations.find((op) => op.operationId === operationId);
}
