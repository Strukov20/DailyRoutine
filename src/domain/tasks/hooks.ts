import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAuth } from '@/lib/auth/AuthProvider';
import {
  completePersonalTask,
  createPersonalTask,
  deleteOrArchivePersonalTask,
  getTask,
  listInboxTasks,
  listOverdueTasks,
  listTasksForDate,
  moveTaskToInbox,
  restorePersonalTask,
  schedulePersonalTask,
  updatePersonalTask,
  type CreatePersonalTaskParams,
  type SchedulePersonalTaskParams,
  type UpdatePersonalTaskParams,
} from '@/lib/tasks/taskService';

import { todayDateString, tomorrowDateString } from './dateUtils';
import { buildDaySections, buildTodaySections } from './sections';
import type { Task } from './types';

/**
 * TanStack Query hooks for personal tasks — the only layer screens talk to
 * for this feature (screens → hooks → taskService → Supabase client, see
 * docs/ARCHITECTURE.md, "Layering"). Mirrors src/domain/family/hooks.ts.
 */

export const taskKeys = {
  inbox: (profileId: string) => ['tasks', 'inbox', profileId] as const,
  forDate: (profileId: string, date: string) => ['tasks', 'date', profileId, date] as const,
  overdue: (profileId: string, beforeDate: string) => ['tasks', 'overdue', profileId, beforeDate] as const,
  detail: (taskId: string) => ['tasks', 'detail', taskId] as const,
};

export function useTask(taskId: string | null) {
  return useQuery({
    queryKey: taskKeys.detail(taskId ?? 'none'),
    queryFn: () => getTask(taskId as string),
    enabled: taskId !== null,
  });
}

/**
 * Invalidates exactly the lists a task mutation can plausibly affect:
 * Inbox, today's overdue bucket, and the two dates the UI actually shows
 * (today, tomorrow) — not the entire query cache (see docs/ARCHITECTURE.md,
 * "query invalidation limited to affected lists"). A manual reschedule to
 * some other date is the one case this doesn't cover directly; that list
 * isn't mounted anywhere in this phase's UI, so there is nothing to keep
 * fresh for it until a future phase adds date navigation.
 */
function invalidateTaskLists(queryClient: QueryClient, profileId: string): void {
  const today = todayDateString();
  const tomorrow = tomorrowDateString();
  void queryClient.invalidateQueries({ queryKey: taskKeys.inbox(profileId) });
  void queryClient.invalidateQueries({ queryKey: taskKeys.overdue(profileId, today) });
  void queryClient.invalidateQueries({ queryKey: taskKeys.forDate(profileId, today) });
  void queryClient.invalidateQueries({ queryKey: taskKeys.forDate(profileId, tomorrow) });
}

function snapshotTaskQueries(queryClient: QueryClient): [QueryKey, Task[] | undefined][] {
  return queryClient.getQueriesData<Task[]>({ queryKey: ['tasks'] });
}

function restoreTaskQueries(
  queryClient: QueryClient,
  snapshot: [QueryKey, Task[] | undefined][],
): void {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}

/** Optimistically rewrites `taskId` wherever it appears in any mounted task-list query. */
function patchTaskInCache(
  queryClient: QueryClient,
  taskId: string,
  updater: (task: Task) => Task,
): void {
  const queries = queryClient.getQueriesData<Task[]>({ queryKey: ['tasks'] });
  for (const [key, data] of queries) {
    if (!data) continue;
    queryClient.setQueryData(
      key,
      data.map((task) => (task.id === taskId ? updater(task) : task)),
    );
  }
}

export function useInboxTasks() {
  const { profile } = useAuth();
  const profileId = profile?.id ?? null;
  return useQuery({
    queryKey: taskKeys.inbox(profileId ?? 'none'),
    queryFn: () => listInboxTasks(profileId as string),
    enabled: profileId !== null,
  });
}

export function useTodaySections() {
  const { profile } = useAuth();
  const profileId = profile?.id ?? null;
  const today = todayDateString();

  const overdueQuery = useQuery({
    queryKey: taskKeys.overdue(profileId ?? 'none', today),
    queryFn: () => listOverdueTasks(profileId as string, today),
    enabled: profileId !== null,
  });
  const todayQuery = useQuery({
    queryKey: taskKeys.forDate(profileId ?? 'none', today),
    queryFn: () => listTasksForDate(profileId as string, today),
    enabled: profileId !== null,
  });

  const sections = useMemo(
    () => buildTodaySections(overdueQuery.data ?? [], todayQuery.data ?? []),
    [overdueQuery.data, todayQuery.data],
  );

  return {
    sections,
    isLoading: overdueQuery.isLoading || todayQuery.isLoading,
    isError: overdueQuery.isError || todayQuery.isError,
    refetch: () => {
      void overdueQuery.refetch();
      void todayQuery.refetch();
    },
  };
}

export function useTomorrowSections() {
  const { profile } = useAuth();
  const profileId = profile?.id ?? null;
  const tomorrow = tomorrowDateString();

  const query = useQuery({
    queryKey: taskKeys.forDate(profileId ?? 'none', tomorrow),
    queryFn: () => listTasksForDate(profileId as string, tomorrow),
    enabled: profileId !== null,
  });

  const sections = useMemo(() => buildDaySections(query.data ?? []), [query.data]);

  return { sections, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}

export function useCreatePersonalTask() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (params: CreatePersonalTaskParams) => createPersonalTask(params),
    onSuccess: () => {
      if (profile) invalidateTaskLists(queryClient, profile.id);
    },
  });
}

export function useUpdatePersonalTask() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (params: UpdatePersonalTaskParams) => updatePersonalTask(params),
    onSuccess: () => {
      if (profile) invalidateTaskLists(queryClient, profile.id);
    },
  });
}

export function useSchedulePersonalTask() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (params: SchedulePersonalTaskParams) => schedulePersonalTask(params),
    onSuccess: () => {
      if (profile) invalidateTaskLists(queryClient, profile.id);
    },
  });
}

export function useMoveTaskToInbox() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (taskId: string) => moveTaskToInbox(taskId),
    onSuccess: () => {
      if (profile) invalidateTaskLists(queryClient, profile.id);
    },
  });
}

export function useDeletePersonalTask() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (taskId: string) => deleteOrArchivePersonalTask(taskId),
    onSuccess: () => {
      if (profile) invalidateTaskLists(queryClient, profile.id);
    },
  });
}

/**
 * Optimistic, per docs/ARCHITECTURE.md's rule: completion (unlike create/
 * schedule/delete) has a trivially safe, deterministic rollback — toggle
 * completedAt back. `isPending` in the calling component is what prevents
 * a duplicate tap (see src/components/tasks/TaskRow.tsx).
 */
export function useCompletePersonalTask() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (taskId: string) => completePersonalTask(taskId),
    onMutate: async (taskId: string) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = snapshotTaskQueries(queryClient);
      patchTaskInCache(queryClient, taskId, (task) => ({
        ...task,
        completedAt: new Date().toISOString(),
      }));
      return { previous };
    },
    onError: (_error, _taskId, context) => {
      if (context?.previous) restoreTaskQueries(queryClient, context.previous);
    },
    onSettled: () => {
      if (profile) invalidateTaskLists(queryClient, profile.id);
    },
  });
}

export function useRestorePersonalTask() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (taskId: string) => restorePersonalTask(taskId),
    onMutate: async (taskId: string) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = snapshotTaskQueries(queryClient);
      patchTaskInCache(queryClient, taskId, (task) => ({ ...task, completedAt: null }));
      return { previous };
    },
    onError: (_error, _taskId, context) => {
      if (context?.previous) restoreTaskQueries(queryClient, context.previous);
    },
    onSettled: () => {
      if (profile) invalidateTaskLists(queryClient, profile.id);
    },
  });
}
