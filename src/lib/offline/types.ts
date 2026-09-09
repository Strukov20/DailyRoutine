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
  | 'delete_personal_task';

/**
 * Section 10 — every queued op's identity/idempotency fields. Never store
 * auth credentials here (the replay worker reuses the app's own
 * already-authenticated Supabase client, same as any other mutation).
 */
export interface OfflineOperation<TPayload = unknown> {
  /** Client-generated UUID — doubles as the RPC's idempotency key (client_operation_id) for a create. */
  operationId: string;
  profileId: string;
  operationType: OfflineOperationType;
  /** The real server task id once known; null only for a not-yet-created task (see clientGeneratedId). */
  entityId: string | null;
  /** Stable id an offline-created task is optimistically rendered under before the server assigns entityId. */
  clientGeneratedId: string | null;
  payload: TPayload;
  /** Optimistic-concurrency precondition for update/schedule — the task's updated_at as last read by this client. */
  expectedUpdatedAt: string | null;
  createdAt: string;
  attemptCount: number;
  status: 'pending' | 'in-flight' | 'failed';
  /** Set only once status is 'failed' — a safe (non-raw-Postgres) code the UI can key a message off of. */
  lastSafeErrorCode: 'conflict' | 'forbidden' | 'invalid_input' | 'unknown' | null;
}

/** Bounded — Section 10: "documented max queue size, no silent dropping when exceeded." */
export const MAX_OFFLINE_QUEUE_SIZE = 200;

/** A permanent failure (never retried automatically again) vs. one worth retrying. */
export const PERMANENT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'forbidden',
  'invalid_input',
  'conflict',
]);

/** Section 12 — bounded attempts before a transient-looking failure is treated as permanent too. */
export const MAX_ATTEMPTS_BEFORE_GIVING_UP = 5;
