import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth/AuthProvider';
import { useOfflineQueueStore } from '@/lib/offline/offlineQueueStore';
import type { OfflineOperation, OfflineOperationType } from '@/lib/offline/types';
import { useIsOffline } from '@/lib/query/useIsOffline';
import {
  completeOccurrence,
  createRecurringTask,
  createTaskReminder,
  deleteTaskReminder,
  ensureOccurrencesGenerated,
  listAllPendingReminders,
  listAllScheduledOccurrences,
  listTaskReminders,
  RecurrenceServiceError,
  rescheduleOccurrence,
  restoreOccurrence,
  skipOccurrence,
  snoozeOccurrence,
  stopRecurringSeries,
  updateRecurringSeries,
} from '@/lib/recurrence/recurrenceService';
import type {
  CreateRecurringTaskParams,
  RescheduleOccurrenceParams,
  UpdateRecurringSeriesParams,
} from './types';

/**
 * TanStack Query hooks for recurring tasks/occurrences/reminders — the
 * only layer screens talk to for this feature (screens → hooks →
 * recurrenceService → Supabase client, see docs/ARCHITECTURE.md,
 * "Layering"). Mirrors src/domain/tasks/hooks.ts / src/domain/calendar/hooks.ts.
 *
 * Deliberately not optimistic (same rationale as Phase 5/7's assignment
 * mutations): completing/rescheduling/skipping an occurrence has no
 * trivially-safe client-side guess, and — because a recurring task's id
 * repeats across every occurrence of the same series — an optimistic patch
 * keyed by task id risks touching the wrong occurrence's row in another
 * mounted list. Invalidation-only sidesteps that entirely.
 */

export const recurrenceKeys = {
  reminders: (taskId: string) => ['recurrence', 'reminders', taskId] as const,
  pendingReminders: (profileId: string) => ['recurrence', 'pending-reminders', profileId] as const,
  scheduledOccurrences: (profileId: string) => ['recurrence', 'scheduled-occurrences', profileId] as const,
};

/**
 * Phase 9, Section 9 — enqueues an offline occurrence operation. Simpler
 * than the one-off-task queue helper in src/domain/tasks/hooks.ts:
 * complete/restore_task_occurrence are already idempotent server-side (a
 * WHERE status = ... guard), so no clientGeneratedId or
 * expectedUpdatedAt precondition is needed here.
 */
async function enqueueOfflineOccurrenceOperation(
  profileId: string,
  operationType: OfflineOperationType,
  occurrenceId: string,
): Promise<boolean> {
  const operation: OfflineOperation = {
    operationId: crypto.randomUUID(),
    profileId,
    operationType,
    entityId: occurrenceId,
    clientGeneratedId: null,
    payload: {},
    expectedUpdatedAt: null,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: 'pending',
    lastSafeErrorCode: null,
  };
  const result = await useOfflineQueueStore.getState().enqueue(operation);
  return result.ok;
}

function invalidateTaskAndRecurrenceLists(queryClient: ReturnType<typeof useQueryClient>, profileId?: string): void {
  void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  if (profileId) {
    void queryClient.invalidateQueries({ queryKey: recurrenceKeys.pendingReminders(profileId) });
    void queryClient.invalidateQueries({ queryKey: recurrenceKeys.scheduledOccurrences(profileId) });
  }
}

export function useCreateRecurringTask() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (params: CreateRecurringTaskParams) => createRecurringTask(params),
    onSuccess: () => invalidateTaskAndRecurrenceLists(queryClient, profile?.id),
  });
}

export function useUpdateRecurringSeries() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (params: UpdateRecurringSeriesParams) => updateRecurringSeries(params),
    onSuccess: () => invalidateTaskAndRecurrenceLists(queryClient, profile?.id),
  });
}

export function useStopRecurringSeries() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (taskId: string) => stopRecurringSeries(taskId),
    onSuccess: () => invalidateTaskAndRecurrenceLists(queryClient, profile?.id),
  });
}

const OFFLINE_QUEUE_FULL_MESSAGE =
  'Too many changes are waiting to sync — connect to the internet to catch up before making more.';

export function useCompleteOccurrence() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const isOffline = useIsOffline();
  return useMutation({
    mutationFn: async (occurrenceId: string) => {
      if (isOffline && profile) {
        const accepted = await enqueueOfflineOccurrenceOperation(profile.id, 'complete_task_occurrence', occurrenceId);
        if (!accepted) throw new RecurrenceServiceError('unknown', OFFLINE_QUEUE_FULL_MESSAGE);
        return;
      }
      return completeOccurrence(occurrenceId);
    },
    onSuccess: () => invalidateTaskAndRecurrenceLists(queryClient, profile?.id),
  });
}

export function useRestoreOccurrence() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const isOffline = useIsOffline();
  return useMutation({
    mutationFn: async (occurrenceId: string) => {
      if (isOffline && profile) {
        const accepted = await enqueueOfflineOccurrenceOperation(profile.id, 'restore_task_occurrence', occurrenceId);
        if (!accepted) throw new RecurrenceServiceError('unknown', OFFLINE_QUEUE_FULL_MESSAGE);
        return;
      }
      return restoreOccurrence(occurrenceId);
    },
    onSuccess: () => invalidateTaskAndRecurrenceLists(queryClient, profile?.id),
  });
}

export function useSkipOccurrence() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (occurrenceId: string) => skipOccurrence(occurrenceId),
    onSuccess: () => invalidateTaskAndRecurrenceLists(queryClient, profile?.id),
  });
}

export function useRescheduleOccurrence() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (params: RescheduleOccurrenceParams) => rescheduleOccurrence(params),
    onSuccess: () => invalidateTaskAndRecurrenceLists(queryClient, profile?.id),
  });
}

export function useTaskReminders(taskId: string | null) {
  return useQuery({
    queryKey: recurrenceKeys.reminders(taskId ?? 'none'),
    queryFn: () => listTaskReminders(taskId as string),
    enabled: taskId !== null,
  });
}

export function useCreateTaskReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { taskId: string; offsetMinutesBefore?: number; remindAt?: string; label?: string }) =>
      createTaskReminder(params),
    onSuccess: (_data, params) => {
      void queryClient.invalidateQueries({ queryKey: recurrenceKeys.reminders(params.taskId) });
    },
  });
}

export function useDeleteTaskReminder(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reminderId: string) => deleteTaskReminder(reminderId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recurrenceKeys.reminders(taskId) });
    },
  });
}

export function useSnoozeOccurrence() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (params: { taskId: string; occurrenceId?: string; minutes?: number; until?: string }) =>
      snoozeOccurrence(params),
    onSuccess: () => {
      if (profile?.id) {
        void queryClient.invalidateQueries({ queryKey: recurrenceKeys.pendingReminders(profile.id) });
      }
    },
  });
}

/**
 * The local scheduler's own read hooks (Section 8) — every currently-
 * pending reminder definition/snooze and every scheduled occurrence the
 * caller owns, for the reconciliation loop to diff against what's actually
 * scheduled on-device. Not used by the Today/Tomorrow screens themselves.
 */
export function usePendingReminders() {
  const { profile } = useAuth();
  const profileId = profile?.id ?? null;
  return useQuery({
    queryKey: recurrenceKeys.pendingReminders(profileId ?? 'none'),
    queryFn: () => listAllPendingReminders(profileId as string),
    enabled: profileId !== null,
  });
}

export function useScheduledOccurrencesForReminders() {
  const { profile } = useAuth();
  const profileId = profile?.id ?? null;
  return useQuery({
    queryKey: recurrenceKeys.scheduledOccurrences(profileId ?? 'none'),
    queryFn: () => listAllScheduledOccurrences(profileId as string),
    enabled: profileId !== null,
  });
}

export { ensureOccurrencesGenerated };
