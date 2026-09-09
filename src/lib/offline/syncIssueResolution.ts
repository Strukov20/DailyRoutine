import type { Task } from '@/domain/tasks/types';
import { createLogger } from '@/lib/logger/logger';
import { getTask, type SchedulePersonalTaskParams, type UpdatePersonalTaskParams } from '@/lib/tasks/taskService';

import { invalidateAfterReplay, replayOperation, runOfflineQueueReplay } from './offlineQueueReplay';
import { selectOperationById, useOfflineQueueStore } from './offlineQueueStore';
import type { OfflineOperation } from './types';

const logger = createLogger('sync-issue-resolution');

/**
 * The Sync Issues resolution actions (Phase 9 completion pass, Section 5).
 * Every function here operates on the *existing* queued operation by its
 * stable `operationId` — none of them ever create a replacement operation,
 * matching the brief's "reuse the same idempotency identity" /
 * "preserve the original operation/audit relationship" requirements.
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
  /** null once the reload discovers the task is gone — see reloadServerSnapshot. */
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
 * Section 4 — fetches the comparison through the authenticated repository
 * and existing RLS (never a cached snapshot trusted as current
 * authorization). Only meaningful for 'conflict' operations
 * (update/schedule_personal_task — the only two operation types that
 * carry an expected-version precondition at all; comparison is
 * deliberately not implemented for anything else, per Section 4's own
 * scope note).
 */
export async function getConflictComparison(operationId: string): Promise<ConflictComparison | null> {
  const operation = selectOperationById(useOfflineQueueStore.getState(), operationId);
  if (!operation || !operation.entityId) return null;
  if (operation.operationType !== 'update_personal_task' && operation.operationType !== 'schedule_personal_task') {
    return null;
  }
  const serverTask = await getTask(operation.entityId);
  if (!serverTask) return { serverTask: null, fields: [] };
  return { serverTask, fields: buildComparisonFields(operation, serverTask) };
}

/**
 * Section 5 — "Reload latest server version." Refreshes the comparison
 * without discarding the local pending operation. If the entity is gone
 * or no longer visible to this caller, transitions the operation to the
 * matching safe issue state instead of leaving it stuck showing a stale
 * comparison — `getTask` goes through the base table's own RLS (a plain
 * `SELECT ... .maybeSingle()`, not an RPC), which cannot itself
 * distinguish "deleted" from "no longer authorized" (both come back as a
 * silent `null`) — for a personal task, ownership never changes hands, so
 * a null result is treated as "deleted," the only reachable cause here.
 */
export async function reloadServerSnapshot(operationId: string): Promise<ConflictComparison | null> {
  const operation = selectOperationById(useOfflineQueueStore.getState(), operationId);
  if (!operation || !operation.entityId) return null;

  const comparison = await getConflictComparison(operationId);
  if (!comparison || !comparison.serverTask) {
    await useOfflineQueueStore.getState().updateOperation(operationId, {
      status: 'permanent_failure',
      lastSafeErrorCode: 'entity_deleted',
    });
    return comparison;
  }
  return comparison;
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

/**
 * Section 5 — "Apply my change." Only valid once the user has reviewed
 * the current server version (callers are expected to have called
 * `getConflictComparison`/`reloadServerSnapshot` first). Re-applies the
 * *original* local patch — never a new/derived payload — against the
 * just-fetched server version as the new expected-version precondition,
 * then lets the server perform the final concurrency check exactly as it
 * would for a normal online edit. Never falls back to last-write-wins: a
 * renewed conflict (someone else changed it again between review and
 * apply) leaves the operation in 'conflict', unresolved.
 */
export async function applyMyChange(
  operationId: string,
): Promise<{ result: 'succeeded' } | { result: 'conflict' } | { result: 'not_applicable' }> {
  const store = useOfflineQueueStore.getState();
  const operation = selectOperationById(store, operationId);
  if (!operation || operation.status !== 'conflict') return { result: 'not_applicable' };
  if (operation.operationType !== 'update_personal_task' && operation.operationType !== 'schedule_personal_task') {
    return { result: 'not_applicable' };
  }
  if (!operation.entityId) return { result: 'not_applicable' };

  const serverTask = await getTask(operation.entityId);
  if (!serverTask) {
    await store.updateOperation(operationId, { status: 'permanent_failure', lastSafeErrorCode: 'entity_deleted' });
    return { result: 'not_applicable' };
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
    logger.warn('apply-my-change hit a renewed conflict — another update happened between review and apply', {
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
  });
  return { result: 'not_applicable' };
}

/**
 * Section 5 — "Retry," restricted to retryable transient failures only
 * (Section 3: never offered for a conflict or a genuinely permanent
 * validation/authorization/deleted failure — "Do not show Retry if the
 * same payload can never succeed"). Reuses the same operationId and the
 * existing bounded queue worker (`runOfflineQueueReplay`, imported by the
 * caller — kept out of this module to avoid a circular import with
 * offlineQueueReplay.ts) rather than replaying directly, so it respects
 * FIFO ordering against whatever else is queued.
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
