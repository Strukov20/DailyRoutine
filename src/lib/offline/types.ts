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
 * 'conflict' -> stale-write conflict, 'permanent_validation' -> permanent
 * validation failure, 'task_unavailable' -> the task no longer exists,
 * belongs to another profile, or is no longer visible to this caller
 * (deliberately one merged outcome — the RPC layer itself never
 * distinguishes these to avoid a cross-user task-existence oracle; see
 * docs/DECISIONS.md, "Phase 9," final security pass), 'unknown' -> a
 * transient-looking failure that exhausted its retry budget (Section 3's
 * "Transient failure," once retries run out).
 */
export type OfflineSafeErrorCode = 'conflict' | 'permanent_validation' | 'task_unavailable' | 'unknown';

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
  /** Optimistic-concurrency precondition for update/schedule — the task's updated_at as last read by this client. Never mutated by a review/comparison fetch — only a *successful* replay (first attempt or an Apply that actually wrote) moves this forward, always to the exact server value that attempt used. */
  expectedUpdatedAt: string | null;
  /**
   * The server row's `updated_at` as it was when the user last *viewed* the
   * comparison screen for this conflict (set by `getConflictComparison`/
   * `reloadServerSnapshot`, never by `applyMyChange` itself) — final
   * security/concurrency pass. "Apply my change" is only ever allowed to
   * proceed when a fresh fetch's version still matches this value; a
   * mismatch means the row changed again after the user's last review and
   * before they pressed Apply, so Apply refuses to mutate and the user
   * must explicitly review the newer version before trying again. `null`
   * whenever the operation isn't a reviewed conflict (never set for a
   * transient/permanent-validation issue, and cleared once the conflict
   * resolves).
   */
  reviewedVersion: string | null;
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
  'task_unavailable',
  'conflict',
]);

/** Section 12 — bounded attempts before a transient-looking failure is treated as permanent too. */
export const MAX_ATTEMPTS_BEFORE_GIVING_UP = 5;
