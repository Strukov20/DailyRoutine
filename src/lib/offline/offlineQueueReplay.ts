import { onlineManager } from '@tanstack/react-query';

import { createLogger } from '@/lib/logger/logger';
import { queryClient } from '@/lib/query/queryClient';
import { queryKeyPrefixesForEntity } from '@/lib/realtime/invalidationMap';
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
import { MAX_ATTEMPTS_BEFORE_GIVING_UP, PERMANENT_FAILURE_CODES, type OfflineOperation } from './types';

const logger = createLogger('offline-queue-replay');

type ReplayOutcome =
  | { result: 'succeeded'; createdEntityId?: string }
  | { result: 'failed'; code: TaskErrorCode };

/**
 * Executes exactly one queued operation against the real RPCs, in the same
 * transport layer any online mutation uses (Section 10: "never create a
 * generic RPC capable of executing arbitrary operation names" — this is a
 * fixed switch over the six known operation types, not a dispatcher). Both
 * create's `clientOperationId` and update/schedule's `expectedUpdatedAt`
 * are what makes a blind retry after a crash or a duplicate delivery safe.
 */
async function replayOperation(operation: OfflineOperation): Promise<ReplayOutcome> {
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
    }
    return { result: 'succeeded' };
  } catch (error) {
    const code = error instanceof TaskServiceError ? error.code : 'unknown';
    return { result: 'failed', code };
  }
}

function invalidateTaskRelatedQueries(): void {
  for (const prefix of queryKeyPrefixesForEntity('tasks')) {
    void queryClient.invalidateQueries({ queryKey: prefix as unknown[] });
  }
}

let activeReplay: Promise<void> | null = null;

/**
 * Section 12 — the queue's own lifecycle: FIFO, one operation in flight at
 * a time, one worker at a time for the whole app (the `activeReplay`
 * module-level guard — sufficient on React Native's single JS thread,
 * unlike a genuinely multi-process client where a persisted lease would be
 * needed). Stops the instant the connection or the queue itself says there
 * is nothing more to safely do; never spins on a timer.
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
        const next = current.operations.find((op) => op.status === 'pending');
        if (!next) break;

        await current.updateOperation(next.operationId, {
          status: 'in-flight',
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
          invalidateTaskRelatedQueries();
          continue;
        }

        const attemptCount = next.attemptCount + 1;
        const isPermanent = PERMANENT_FAILURE_CODES.has(outcome.code);
        const exhausted = attemptCount >= MAX_ATTEMPTS_BEFORE_GIVING_UP;

        if (isPermanent || exhausted) {
          logger.warn('an offline operation failed permanently and will not be retried automatically', {
            operationType: next.operationType,
            code: outcome.code,
          });
          await useOfflineQueueStore.getState().updateOperation(next.operationId, {
            status: 'failed',
            lastSafeErrorCode: outcome.code,
          });
          // A permanently-failed op never blocks unrelated later-queued
          // ones — keep draining the rest of the queue.
          continue;
        }

        // Looks transient (most often: the device just went offline
        // mid-request) — leave it 'pending' for the next trigger (network
        // restore, foreground, manual retry) rather than spinning here.
        await useOfflineQueueStore.getState().updateOperation(next.operationId, { status: 'pending' });
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
