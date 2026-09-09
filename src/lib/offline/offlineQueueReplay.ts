import { onlineManager } from '@tanstack/react-query';

import { createLogger } from '@/lib/logger/logger';
import { queryClient } from '@/lib/query/queryClient';
import { queryKeyPrefixesForEntity } from '@/lib/realtime/invalidationMap';
import {
  completeOccurrence,
  restoreOccurrence,
  RecurrenceServiceError,
  type RecurrenceErrorCode,
} from '@/lib/recurrence/recurrenceService';
import {
  completePersonalTask,
  createPersonalTask,
  deleteOrArchivePersonalTask,
  restorePersonalTask,
  schedulePersonalTask,
  TaskServiceError,
  updatePersonalTask,
  type CreatePersonalTaskParams,
  type SchedulePersonalTaskParams,
  type TaskErrorCode,
  type UpdatePersonalTaskParams,
} from '@/lib/tasks/taskService';

import { useOfflineQueueStore } from './offlineQueueStore';
import {
  MAX_ATTEMPTS_BEFORE_GIVING_UP,
  PERMANENT_FAILURE_CODES,
  type OfflineOperation,
  type OfflineSafeErrorCode,
} from './types';

const logger = createLogger('offline-queue-replay');

export type ReplayOutcome =
  | { result: 'succeeded'; createdEntityId?: string }
  | { result: 'failed'; code: OfflineSafeErrorCode };

/**
 * Maps the transport layer's own error taxonomy onto the queue's safe,
 * user-facing vocabulary (Sync Issues completion pass). 'forbidden' covers
 * every one of the RPC layer's deliberately-merged "task unavailable"
 * cases (doesn't exist / belongs to someone else / no longer visible) —
 * see docs/DECISIONS.md, "Phase 9," final security pass, for why the RPCs
 * themselves never distinguish these (a distinct code would let an
 * offline replay's error surface the same cross-user existence oracle the
 * server-side fix removed).
 */
function toSafeErrorCode(code: TaskErrorCode | RecurrenceErrorCode): OfflineSafeErrorCode {
  switch (code) {
    case 'conflict':
      return 'conflict';
    case 'forbidden':
      return 'task_unavailable';
    case 'invalid_input':
      return 'permanent_validation';
    case 'unknown':
    default:
      return 'unknown';
  }
}

/**
 * Executes exactly one queued operation against the real RPCs, in the same
 * transport layer any online mutation uses (Section 10: "never create a
 * generic RPC capable of executing arbitrary operation names" — this is a
 * fixed switch over the known operation types, not a dispatcher). Both
 * create's `clientOperationId` and update/schedule's `expectedUpdatedAt`
 * are what makes a blind retry after a crash or a duplicate delivery safe.
 */
export async function replayOperation(operation: OfflineOperation): Promise<ReplayOutcome> {
  try {
    switch (operation.operationType) {
      case 'create_personal_task': {
        const payload = operation.payload as CreatePersonalTaskParams;
        const createdEntityId = await createPersonalTask({
          ...payload,
          clientOperationId: operation.operationId,
        });
        return { result: 'succeeded', createdEntityId };
      }
      case 'update_personal_task': {
        if (!operation.entityId) throw new TaskServiceError('invalid_input', 'missing entityId');
        const payload = operation.payload as UpdatePersonalTaskParams;
        await updatePersonalTask({
          ...payload,
          taskId: operation.entityId,
          expectedUpdatedAt: operation.expectedUpdatedAt ?? undefined,
        });
        break;
      }
      case 'schedule_personal_task': {
        if (!operation.entityId) throw new TaskServiceError('invalid_input', 'missing entityId');
        const payload = operation.payload as SchedulePersonalTaskParams;
        await schedulePersonalTask({
          ...payload,
          taskId: operation.entityId,
          expectedUpdatedAt: operation.expectedUpdatedAt ?? undefined,
        });
        break;
      }
      case 'complete_personal_task': {
        if (!operation.entityId) throw new TaskServiceError('invalid_input', 'missing entityId');
        await completePersonalTask(operation.entityId);
        break;
      }
      case 'restore_personal_task': {
        if (!operation.entityId) throw new TaskServiceError('invalid_input', 'missing entityId');
        await restorePersonalTask(operation.entityId);
        break;
      }
      case 'delete_personal_task': {
        if (!operation.entityId) throw new TaskServiceError('invalid_input', 'missing entityId');
        await deleteOrArchivePersonalTask(operation.entityId);
        break;
      }
      case 'complete_task_occurrence': {
        if (!operation.entityId) throw new TaskServiceError('invalid_input', 'missing entityId');
        await completeOccurrence(operation.entityId);
        break;
      }
      case 'restore_task_occurrence': {
        if (!operation.entityId) throw new TaskServiceError('invalid_input', 'missing entityId');
        await restoreOccurrence(operation.entityId);
        break;
      }
    }
    return { result: 'succeeded' };
  } catch (error) {
    const rawCode =
      error instanceof TaskServiceError || error instanceof RecurrenceServiceError ? error.code : 'unknown';
    return { result: 'failed', code: toSafeErrorCode(rawCode) };
  }
}

/**
 * `usePendingReminders`/`useScheduledOccurrencesForReminders` (which drive
 * `useReminderReconciliation`'s automatic re-run — Section 5: "reconcile
 * local reminders if the task schedule changed") are keyed under
 * `['recurrence', ...]`, not `['tasks', ...]` — a plain task schedule/
 * complete/restore/delete replay invalidating only the 'tasks' entity
 * would silently leave a stale local reminder scheduled. Every operation
 * type except a fresh create (which can't have a reminder attached yet)
 * invalidates both.
 */
export function invalidateAfterReplay(operationType: OfflineOperation['operationType']): void {
  const entities: Parameters<typeof queryKeyPrefixesForEntity>[0][] =
    operationType === 'create_personal_task' ? ['tasks'] : ['tasks', 'recurrence'];
  const seen = new Set<string>();
  for (const entity of entities) {
    for (const prefix of queryKeyPrefixesForEntity(entity)) {
      const key = JSON.stringify(prefix);
      if (seen.has(key)) continue;
      seen.add(key);
      void queryClient.invalidateQueries({ queryKey: prefix as unknown[] });
    }
  }
}

let activeReplay: Promise<void> | null = null;

/**
 * Section 12/6 — the queue's own lifecycle: FIFO, one operation in flight
 * at a time, one worker at a time for the whole app (the `activeReplay`
 * module-level guard — sufficient on React Native's single JS thread,
 * unlike a genuinely multi-process client where a persisted lease would be
 * needed — this is also what "prevent simultaneous duplicate retries"
 * (Section 5) relies on: a manual Retry just flips one op back to
 * 'pending' and calls this same function, joining whatever pass is
 * already running rather than racing it). Stops the instant the
 * connection or the queue itself says there is nothing more to safely do;
 * never spins on a timer. Picks up both 'pending' (never yet attempted)
 * and 'retry_wait' (previously failed transiently) operations — both mean
 * the same thing to the worker: "waiting for its turn."
 */
export function runOfflineQueueReplay(): Promise<void> {
  if (activeReplay) return activeReplay;

  activeReplay = (async () => {
    const store = useOfflineQueueStore.getState();
    if (!store.profileId) return;
    store.setReplaying(true);
    try {
      for (;;) {
        if (!onlineManager.isOnline()) break;
        const current = useOfflineQueueStore.getState();
        const next = current.operations
          .filter((op) => op.status === 'pending' || op.status === 'retry_wait')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        if (!next) break;

        await current.updateOperation(next.operationId, {
          status: 'syncing',
          attemptCount: next.attemptCount + 1,
        });

        const outcome = await replayOperation(next);

        if (outcome.result === 'succeeded') {
          if (next.clientGeneratedId && outcome.createdEntityId) {
            await useOfflineQueueStore
              .getState()
              .remapClientGeneratedId(next.clientGeneratedId, outcome.createdEntityId);
          }
          await useOfflineQueueStore.getState().removeOperation(next.operationId);
          invalidateAfterReplay(next.operationType);
          continue;
        }

        const attemptCount = next.attemptCount + 1;
        const isPermanent = PERMANENT_FAILURE_CODES.has(outcome.code);
        const exhausted = attemptCount >= MAX_ATTEMPTS_BEFORE_GIVING_UP;

        if (outcome.code === 'conflict') {
          // Needs review — never auto-retried, and deliberately not
          // lumped in with the other permanent-failure reasons (Section
          // 3: "Do not expose a generic Retry action before the user
          // chooses a resolution").
          await useOfflineQueueStore.getState().updateOperation(next.operationId, {
            status: 'conflict',
            lastSafeErrorCode: 'conflict',
          });
          continue;
        }

        if (isPermanent || exhausted) {
          logger.warn('an offline operation failed permanently and will not be retried automatically', {
            operationType: next.operationType,
            code: outcome.code,
          });
          await useOfflineQueueStore.getState().updateOperation(next.operationId, {
            status: 'permanent_failure',
            lastSafeErrorCode: exhausted && !isPermanent ? 'unknown' : outcome.code,
          });
          // A permanently-failed op never blocks unrelated later-queued
          // ones — keep draining the rest of the queue.
          continue;
        }

        // Looks transient (most often: the device just went offline
        // mid-request) — leave it 'retry_wait' for the next trigger
        // (network restore, foreground, manual retry) rather than
        // spinning here.
        await useOfflineQueueStore.getState().updateOperation(next.operationId, { status: 'retry_wait' });
        break;
      }
    } finally {
      useOfflineQueueStore.getState().setReplaying(false);
    }
  })().finally(() => {
    activeReplay = null;
  });

  return activeReplay;
}
