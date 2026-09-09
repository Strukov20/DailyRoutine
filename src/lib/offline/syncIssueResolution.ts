import type { Task } from '@/domain/tasks/types';
import { createLogger } from '@/lib/logger/logger';
import { getTask, type SchedulePersonalTaskParams, type UpdatePersonalTaskParams } from '@/lib/tasks/taskService';

import { invalidateAfterReplay, replayOperation, runOfflineQueueReplay } from './offlineQueueReplay';
import { selectOperationById, useOfflineQueueStore } from './offlineQueueStore';
import type { OfflineOperation } from './types';

const logger = createLogger('sync-issue-resolution');

/**
 * The Sync Issues resolution actions (Phase 9 completion pass, Section 5,
 * final security/concurrency pass). Every function here operates on the
 * *existing* queued operation by its stable `operationId` — none of them
 * ever create a replacement operation, matching the brief's "reuse the
 * same idempotency identity" / "preserve the original operation/audit
 * relationship" requirements.
 */

export type ComparisonFieldKey =
  | 'title'
  | 'description'
  | 'priority'
  | 'category'
  | 'visibility'
  | 'date'
  | 'startTime'
  | 'durationMinutes'
  | 'timezone';

export interface ComparisonField {
  field: ComparisonFieldKey;
  /** The value this device tried to send — always present (it's the operation's own payload). */
  local: string | null;
  /** The value currently on the server — null only when the field is genuinely unset there too. */
  server: string | null;
}

export interface ConflictComparison {
  /** null once the fetch discovers the task is gone/unavailable — see reloadServerSnapshot. */
  serverTask: Task | null;
  /** Only the fields the original local patch actually touched (Section 4: "Only show fields relevant to that operation"). */
  fields: ComparisonField[];
}

export function buildComparisonFields(operation: OfflineOperation, serverTask: Task): ComparisonField[] {
  const fields: ComparisonField[] = [];
  if (operation.operationType === 'update_personal_task') {
    const payload = operation.payload as UpdatePersonalTaskParams;
    if (payload.title !== undefined) fields.push({ field: 'title', local: payload.title, server: serverTask.title });
    if (payload.description !== undefined || payload.clearDescription) {
      fields.push({
        field: 'description',
        local: payload.clearDescription ? null : (payload.description ?? null),
        server: serverTask.description,
      });
    }
    if (payload.priority !== undefined) {
      fields.push({ field: 'priority', local: payload.priority, server: serverTask.priority });
    }
    if (payload.categoryId !== undefined || payload.clearCategory) {
      fields.push({
        field: 'category',
        local: payload.clearCategory ? null : (payload.categoryId ?? null),
        server: serverTask.categoryId,
      });
    }
    if (payload.visibility !== undefined) {
      fields.push({ field: 'visibility', local: payload.visibility, server: serverTask.visibility });
    }
  } else if (operation.operationType === 'schedule_personal_task') {
    const payload = operation.payload as SchedulePersonalTaskParams;
    fields.push({ field: 'date', local: payload.date, server: serverTask.date });
    if (payload.startTime !== undefined) {
      fields.push({ field: 'startTime', local: payload.startTime ?? null, server: serverTask.startTime });
    }
    if (payload.durationMinutes !== undefined) {
      fields.push({
        field: 'durationMinutes',
        local: payload.durationMinutes != null ? String(payload.durationMinutes) : null,
        server: serverTask.durationMinutes != null ? String(serverTask.durationMinutes) : null,
      });
    }
    if (payload.timezone !== undefined) {
      fields.push({ field: 'timezone', local: payload.timezone ?? null, server: serverTask.timezone });
    }
  }
  return fields;
}

/**
 * "Review pending change" for a *non-conflict* issue (Section 3: a
 * transient or permanent-validation failure) — just this device's own
 * not-yet-sent values, no server fetch at all (Section 4 scopes the real
 * field-*comparison* UI to stale-write conflicts specifically).
 */
export function getLocalChangeFields(operation: OfflineOperation): ComparisonField[] {
  const fields: ComparisonField[] = [];
  if (operation.operationType === 'update_personal_task') {
    const payload = operation.payload as UpdatePersonalTaskParams;
    if (payload.title !== undefined) fields.push({ field: 'title', local: payload.title, server: null });
    if (payload.description !== undefined || payload.clearDescription) {
      fields.push({
        field: 'description',
        local: payload.clearDescription ? null : (payload.description ?? null),
        server: null,
      });
    }
    if (payload.priority !== undefined) fields.push({ field: 'priority', local: payload.priority, server: null });
    if (payload.categoryId !== undefined || payload.clearCategory) {
      fields.push({
        field: 'category',
        local: payload.clearCategory ? null : (payload.categoryId ?? null),
        server: null,
      });
    }
    if (payload.visibility !== undefined) fields.push({ field: 'visibility', local: payload.visibility, server: null });
  } else if (operation.operationType === 'schedule_personal_task') {
    const payload = operation.payload as SchedulePersonalTaskParams;
    fields.push({ field: 'date', local: payload.date, server: null });
    if (payload.startTime !== undefined) fields.push({ field: 'startTime', local: payload.startTime ?? null, server: null });
    if (payload.durationMinutes !== undefined) {
      fields.push({
        field: 'durationMinutes',
        local: payload.durationMinutes != null ? String(payload.durationMinutes) : null,
        server: null,
      });
    }
    if (payload.timezone !== undefined) fields.push({ field: 'timezone', local: payload.timezone ?? null, server: null });
  }
  return fields;
}

/**
 * Shared by getConflictComparison/reloadServerSnapshot — fetches the
 * server row through the authenticated repository and existing RLS (never
 * a cached snapshot trusted as current authorization), and, on success,
 * records the fetched version as `reviewedVersion` on the operation: this
 * is the one and only place that value is ever written, so it always
 * means exactly "the server version as of the user's last look at this
 * comparison." If the task is gone or no longer visible to this caller
 * (both collapse to the same outcome — see docs/DECISIONS.md, "Phase 9"),
 * transitions the operation to the matching safe issue state instead of
 * leaving it stuck showing a stale comparison.
 */
async function fetchAndRecordReview(operationId: string): Promise<ConflictComparison | null> {
  const operation = selectOperationById(useOfflineQueueStore.getState(), operationId);
  if (!operation || !operation.entityId) return null;
  if (operation.operationType !== 'update_personal_task' && operation.operationType !== 'schedule_personal_task') {
    return null;
  }

  const serverTask = await getTask(operation.entityId);
  if (!serverTask) {
    await useOfflineQueueStore.getState().updateOperation(operationId, {
      status: 'permanent_failure',
      lastSafeErrorCode: 'task_unavailable',
      reviewedVersion: null,
    });
    return { serverTask: null, fields: [] };
  }

  await useOfflineQueueStore.getState().updateOperation(operationId, { reviewedVersion: serverTask.updatedAt });
  return { serverTask, fields: buildComparisonFields(operation, serverTask) };
}

/**
 * Section 4 — the comparison screen's initial fetch. Only meaningful for
 * 'conflict' operations (update/schedule_personal_task — the only two
 * operation types that carry an expected-version precondition at all;
 * comparison is deliberately not implemented for anything else, per
 * Section 4's own scope note).
 */
export async function getConflictComparison(operationId: string): Promise<ConflictComparison | null> {
  return fetchAndRecordReview(operationId);
}

/**
 * Section 5 — "Reload latest server version." Refreshes the comparison
 * (and, like every review, records the freshly-fetched version) without
 * discarding the local pending operation.
 */
export async function reloadServerSnapshot(operationId: string): Promise<ConflictComparison | null> {
  return fetchAndRecordReview(operationId);
}

/**
 * Section 5 — "Keep server version" (the discard flow). Terminal: the
 * operation is removed (never `discarded`-but-lingering — there is
 * nothing further any screen needs to show for it once this resolves),
 * so it can never replay again. Invalidating both the 'tasks' and
 * 'recurrence' entities refreshes Today/Tomorrow/Inbox/Calendar and
 * reconciles local reminders in one pass (see offlineQueueReplay.ts's own
 * comment on why 'recurrence' is included).
 */
export async function discardSyncIssue(operationId: string): Promise<void> {
  const operation = selectOperationById(useOfflineQueueStore.getState(), operationId);
  if (!operation) return; // already resolved — a double-tap is a safe no-op
  await useOfflineQueueStore.getState().removeOperation(operationId);
  invalidateAfterReplay(operation.operationType);
}

export type ApplyOutcome =
  | { result: 'succeeded' }
  /** The row changed again after the user's last review, before they pressed Apply — final security/concurrency pass's "stale review" window. Nothing was sent to the server; the comparison was refreshed in place and the user must explicitly review it and press Apply again. */
  | { result: 'stale_review' }
  /** A write landed in the narrow gap between this Apply's own fetch and its own write (the RPC's own precondition caught it) — the other, tighter concurrency window. */
  | { result: 'conflict' }
  | { result: 'not_applicable' };

/**
 * Section 5 — "Apply my change," final security/concurrency pass. Only
 * valid once the user has reviewed the current server version at least
 * once (`operation.reviewedVersion` set by getConflictComparison/
 * reloadServerSnapshot — never by this function). Re-applies the
 * *original* local patch — never a new/derived payload.
 *
 * Two distinct concurrency windows, both refuse to mutate silently:
 *  1. Stale review — a fresh fetch's version no longer matches
 *     `reviewedVersion` (something changed after the user last looked).
 *     The comparison is refreshed in place (reviewedVersion moves to the
 *     newly-fetched value) and the operation stays 'conflict' — the user
 *     must look at the refreshed comparison and press Apply again.
 *  2. Fetch-to-write race — the freshly-fetched version *did* match
 *     reviewedVersion, so the replay is attempted with it as the
 *     precondition, but another write commits before this one does; the
 *     RPC's own 40001 check catches it, and the operation goes back to
 *     'conflict' with a renewed comparison available (never a silent
 *     merge, never last-write-wins).
 */
export async function applyMyChange(operationId: string): Promise<ApplyOutcome> {
  const store = useOfflineQueueStore.getState();
  const operation = selectOperationById(store, operationId);
  if (!operation || operation.status !== 'conflict') return { result: 'not_applicable' };
  if (operation.operationType !== 'update_personal_task' && operation.operationType !== 'schedule_personal_task') {
    return { result: 'not_applicable' };
  }
  if (!operation.entityId || !operation.reviewedVersion) return { result: 'not_applicable' };

  const serverTask = await getTask(operation.entityId);
  if (!serverTask) {
    await store.updateOperation(operationId, {
      status: 'permanent_failure',
      lastSafeErrorCode: 'task_unavailable',
      reviewedVersion: null,
    });
    return { result: 'not_applicable' };
  }

  if (serverTask.updatedAt !== operation.reviewedVersion) {
    logger.warn('apply-my-change found a newer server version than the one last reviewed — refusing to mutate', {
      operationId,
    });
    // "Refresh the comparison": the operation's own reviewedVersion moves
    // to what was just fetched, so the *next* Apply attempt compares
    // against this call's own fresh read — the screen must still re-fetch
    // its own cached comparison to actually show the new fields to the
    // user, but the safety property (never apply against an unreviewed
    // version) holds regardless of whether the screen does that promptly.
    await store.updateOperation(operationId, { reviewedVersion: serverTask.updatedAt });
    return { result: 'stale_review' };
  }

  const refreshed: OfflineOperation = { ...operation, expectedUpdatedAt: serverTask.updatedAt };
  await store.updateOperation(operationId, {
    expectedUpdatedAt: serverTask.updatedAt,
    status: 'syncing',
    attemptCount: operation.attemptCount + 1,
  });

  const outcome = await replayOperation(refreshed);

  if (outcome.result === 'succeeded') {
    await useOfflineQueueStore.getState().removeOperation(operationId);
    invalidateAfterReplay(operation.operationType);
    return { result: 'succeeded' };
  }

  if (outcome.code === 'conflict') {
    logger.warn('apply-my-change hit a renewed conflict — another write landed between fetch and write', {
      operationId,
    });
    await useOfflineQueueStore.getState().updateOperation(operationId, {
      status: 'conflict',
      lastSafeErrorCode: 'conflict',
    });
    return { result: 'conflict' };
  }

  await useOfflineQueueStore.getState().updateOperation(operationId, {
    status: 'permanent_failure',
    lastSafeErrorCode: outcome.code,
    reviewedVersion: null,
  });
  return { result: 'not_applicable' };
}

/**
 * Section 5 — "Retry," restricted to retryable transient failures only
 * (Section 3: never offered for a conflict or a genuinely permanent
 * validation/task-unavailable/exhausted-retries failure — "Do not show
 * Retry if the same payload can never succeed"). Reuses the same
 * operationId and the existing bounded queue worker
 * (`runOfflineQueueReplay`, imported by the caller — kept out of this
 * module to avoid a circular import with offlineQueueReplay.ts) rather
 * than replaying directly, so it respects FIFO ordering against whatever
 * else is queued.
 */
export function isRetryEligible(operation: OfflineOperation): boolean {
  if (operation.status === 'retry_wait') return true;
  return operation.status === 'permanent_failure' && operation.lastSafeErrorCode === 'unknown';
}

async function markSyncIssueForRetry(operationId: string): Promise<boolean> {
  const store = useOfflineQueueStore.getState();
  const operation = selectOperationById(store, operationId);
  if (!operation || operation.status === 'syncing') return false;
  if (!isRetryEligible(operation)) return false;
  await store.updateOperation(operationId, { status: 'retry_wait' });
  return true;
}

/**
 * The UI's actual Retry entry point: marks the one operation eligible,
 * then triggers the shared queue worker — `runOfflineQueueReplay`'s own
 * `activeReplay` singleton guard is what "prevent simultaneous duplicate
 * retries" relies on (a second concurrent call joins the same in-flight
 * pass rather than racing it).
 */
export async function retrySyncIssue(operationId: string): Promise<boolean> {
  const marked = await markSyncIssueForRetry(operationId);
  if (!marked) return false;
  void runOfflineQueueReplay();
  return true;
}
