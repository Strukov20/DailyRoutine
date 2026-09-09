/**
 * Phase 9, Section 9 — the bounded offline mutation queue's own vocabulary.
 * Scope is deliberately narrow: only the six *safe personal-task*
 * operations below are ever queued while offline. Everything else (family/
 * shared task mutations, assignments, invitations, membership, events,
 * responsibilities, recurrence-series edits, reminder-definition edits,
 * category creation, notification token changes) stays disabled offline
 * with a clear message — see docs/DECISIONS.md, "Phase 9."
 */
export type OfflineOperationType =
  | 'create_personal_task'
  | 'update_personal_task'
  | 'schedule_personal_task'
  | 'complete_personal_task'
  | 'restore_personal_task'
  | 'delete_personal_task'
  // Section 9's own list also names these two — unlike the one-off-task
  // ops above, complete_task_occurrence/restore_task_occurrence are
  // already idempotent by construction server-side (a WHERE status = ...
  // guard, no client_operation_id or expected_updated_at needed — see
  // docs/DECISIONS.md, "Phase 9").
  | 'complete_task_occurrence'
  | 'restore_task_occurrence';

/**
 * The operation state machine (Sync Issues completion pass — see
 * docs/DECISIONS.md, "Phase 9"). Stored states only; 'applied'/'completed'
 * from the brief's own conceptual diagram are never *persisted* as a
 * lingering row — a successful replay (first attempt or after a resolved
 * conflict) simply removes the operation from the queue, which already
 * satisfies "terminal operations never return to the replay queue"
 * without needing a completed-but-kept-around row. 'reviewing' is
 * UI-only (the comparison screen being open) and isn't persisted either.
 *
 *   pending        -- queued, never yet attempted
 *   syncing        -- the replay worker has this op in flight right now
 *   retry_wait     -- a transient failure, waiting for the next trigger
 *   conflict       -- stale-write (expected_updated_at mismatch); needs review
 *   permanent_failure -- validation/not-found/authorization/exhausted-retries;
 *                        needs the user to discard (never auto-retried)
 *   discarded      -- terminal; the user chose to keep the server version
 *                      (or the item resolved itself as no longer applicable)
 *
 * Transitions: pending/retry_wait -> syncing -> {removed (success) |
 * retry_wait (transient) | conflict | permanent_failure}; conflict ->
 * syncing (via "Apply my change", reusing the same operationId) ->
 * {removed (success) | conflict (concurrent update happened again)};
 * conflict/permanent_failure -> discarded (terminal, never replays again).
 */
export type OfflineOperationStatus =
  | 'pending'
  | 'syncing'
  | 'retry_wait'
  | 'conflict'
  | 'permanent_failure'
  | 'discarded';

/**
 * A safe (never-raw-Postgres) classification of *why* an operation needs
 * attention — set only once status is 'conflict' or 'permanent_failure'.
 * Maps 1:1 to the brief's five "issue types": 'conflict' -> stale-write
 * conflict, 'permanent_validation' -> permanent validation failure,
 * 'authorization_lost' -> authorization loss, 'entity_deleted' -> deleted
 * entity, 'unknown' -> a transient-looking failure that exhausted its
 * retry budget (Section 3's "Transient failure," once retries run out).
 */
export type OfflineSafeErrorCode =
  | 'conflict'
  | 'permanent_validation'
  | 'authorization_lost'
  | 'entity_deleted'
  | 'unknown';

/**
 * Section 10 — every queued op's identity/idempotency fields. Never store
 * auth credentials here (the replay worker reuses the app's own
 * already-authenticated Supabase client, same as any other mutation).
 */
export interface OfflineOperation<TPayload = unknown> {
  /** Client-generated UUID — doubles as the RPC's idempotency key (client_operation_id) for a create. Reused verbatim for every retry/re-apply of the same logical operation — a resolution action never creates a replacement operation. */
  operationId: string;
  profileId: string;
  operationType: OfflineOperationType;
  /** The real server task id once known; null only for a not-yet-created task (see clientGeneratedId). */
  entityId: string | null;
  /** Stable id an offline-created task is optimistically rendered under before the server assigns entityId. */
  clientGeneratedId: string | null;
  payload: TPayload;
  /** Optimistic-concurrency precondition for update/schedule — the task's updated_at as last read by this client. Refreshed in place by "Apply my change" (Section 5) — never a new operation. */
  expectedUpdatedAt: string | null;
  createdAt: string;
  attemptCount: number;
  status: OfflineOperationStatus;
  /** Set only once status is 'conflict' or 'permanent_failure' — see OfflineSafeErrorCode. */
  lastSafeErrorCode: OfflineSafeErrorCode | null;
}

/** Bounded — Section 10: "documented max queue size, no silent dropping when exceeded." */
export const MAX_OFFLINE_QUEUE_SIZE = 200;

/** A permanent failure (never retried automatically again) vs. one worth retrying. */
export const PERMANENT_FAILURE_CODES: ReadonlySet<OfflineSafeErrorCode> = new Set([
  'permanent_validation',
  'authorization_lost',
  'entity_deleted',
  'conflict',
]);

/** Section 12 — bounded attempts before a transient-looking failure is treated as permanent too. */
export const MAX_ATTEMPTS_BEFORE_GIVING_UP = 5;
