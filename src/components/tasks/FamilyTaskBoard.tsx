import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { FAB } from 'react-native-paper';

import { useCategories } from '@/domain/categories/hooks';
import type { FamilyMember } from '@/domain/family/types';
import { buildFamilyBoardSections } from '@/domain/tasks/familyBoardSections';
import {
  useAcceptTaskAssignment,
  useAssignFamilyTask,
  useCompleteSharedTask,
  useDeclineTaskAssignment,
  useDeletePersonalTask,
  useFamilyTasks,
  useReassignFamilyTask,
  useRestoreSharedTask,
  useTakeFamilyTask,
  useUnassignFamilyTask,
} from '@/domain/tasks/hooks';
import type { Task } from '@/domain/tasks/types';
import { useAuth } from '@/lib/auth/AuthProvider';
import { TaskServiceError } from '@/lib/tasks/taskService';
import { createLogger } from '@/lib/logger/logger';
import { useIsOffline } from '@/lib/query/useIsOffline';
import { useAppTheme } from '@/theme';

import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { LoadingState } from '../ui/LoadingState';
import { OfflineBanner } from '../ui/OfflineBanner';
import { FamilyTaskRow } from './FamilyTaskRow';
import { QuickAddInput } from './QuickAddInput';
import { SectionHeader } from './SectionHeader';

const logger = createLogger('family-task-board');

interface FamilyTaskBoardProps {
  familyId: string;
  members: FamilyMember[];
}

/**
 * The Family Space's shared-task board (Phase 5) — five sections (Awaiting
 * your response, My family tasks, Unassigned, Assigned to others,
 * Completed), each fed by src/domain/tasks/familyBoardSections.ts.
 * Assignment-state actions (Take/Accept/Decline/Assign/Reassign/Unassign)
 * are disabled while offline (Section 12 — no optimistic "success" before
 * the server confirms a security-sensitive mutation); completion stays
 * optimistic, same as the personal planner.
 */
export function FamilyTaskBoard({ familyId, members }: FamilyTaskBoardProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const theme = useAppTheme();
  const { profile } = useAuth();
  const isOffline = useIsOffline();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tasksQuery = useFamilyTasks(familyId);
  const categoriesQuery = useCategories();
  const takeTask = useTakeFamilyTask(familyId);
  const acceptTask = useAcceptTaskAssignment(familyId);
  const declineTask = useDeclineTaskAssignment(familyId);
  const assignTask = useAssignFamilyTask(familyId);
  const reassignTask = useReassignFamilyTask(familyId);
  const unassignTask = useUnassignFamilyTask(familyId);
  const completeTask = useCompleteSharedTask(familyId);
  const restoreTask = useRestoreSharedTask(familyId);
  const archiveTask = useDeletePersonalTask();

  if (tasksQuery.isLoading) {
    return <LoadingState />;
  }

  if (tasksQuery.isError) {
    return <ErrorState onRetry={() => void tasksQuery.refetch()} />;
  }

  const profileId = profile?.id ?? '';
  const currentMemberId = members.find((member) => member.profileId === profileId)?.id ?? null;
  const activeMembers = members.filter((member) => !member.removedAt);
  const categoriesById = Object.fromEntries((categoriesQuery.data ?? []).map((c) => [c.id, c]));
  const tasks = tasksQuery.data ?? [];
  const sections = buildFamilyBoardSections(tasks, profileId, currentMemberId);

  const runAction = async (taskId: string, action: () => Promise<void>) => {
    setActionError(null);
    setBusyTaskId(taskId);
    try {
      await action();
    } catch (caught) {
      const code = caught instanceof TaskServiceError ? caught.code : 'unknown';
      logger.warn('family task action failed', { code });
      setActionError(
        code === 'conflict' ? t('tasks:errors.conflict') : t('common:state.somethingWentWrong'),
      );
    } finally {
      setBusyTaskId(null);
    }
  };

  const renderRow = (task: Task) => {
    const canManage = task.ownerProfileId === profileId;
    return (
      <FamilyTaskRow
        key={task.id}
        task={task}
        category={task.categoryId ? categoriesById[task.categoryId] : undefined}
        members={activeMembers}
        currentProfileId={profileId}
        currentMemberId={currentMemberId}
        canManage={canManage}
        isBusy={busyTaskId === task.id}
        disabled={isOffline}
        onTake={() => void runAction(task.id, () => takeTask.mutateAsync(task.id))}
        onAccept={() => void runAction(task.id, () => acceptTask.mutateAsync(task.id))}
        onDecline={() => void runAction(task.id, () => declineTask.mutateAsync(task.id))}
        onAssign={(memberId) =>
          void runAction(task.id, () =>
            assignTask.mutateAsync({ taskId: task.id, assigneeMemberId: memberId }),
          )
        }
        onReassign={(memberId) =>
          void runAction(task.id, () =>
            reassignTask.mutateAsync({ taskId: task.id, assigneeMemberId: memberId }),
          )
        }
        onUnassign={() => void runAction(task.id, () => unassignTask.mutateAsync(task.id))}
        onToggleComplete={() =>
          void runAction(
            task.id,
            task.completedAt
              ? () => restoreTask.mutateAsync(task.id)
              : () => completeTask.mutateAsync(task.id),
          )
        }
        onEdit={() => router.push({ pathname: '/task/[id]/edit', params: { id: task.id } })}
        onArchive={() => void runAction(task.id, () => archiveTask.mutateAsync(task.id))}
      />
    );
  };

  const sectionList = [
    {
      key: 'awaiting',
      title: t('tasks:board.awaitingMyResponse'),
      data: sections.awaitingMyResponse,
    },
    { key: 'mine', title: t('tasks:board.myFamilyTasks'), data: sections.myFamilyTasks },
    { key: 'unassigned', title: t('tasks:board.unassignedSection'), data: sections.unassigned },
    { key: 'others', title: t('tasks:board.assignedToOthers'), data: sections.assignedToOthers },
    { key: 'completed', title: t('tasks:sections.completed'), data: sections.completed },
  ].filter((section) => section.data.length > 0);

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <OfflineBanner />
        <QuickAddInput familyId={familyId} />
        {actionError ? <ErrorState title={actionError} /> : null}
      </View>

      {sectionList.length === 0 ? (
        <EmptyState
          title={t('tasks:board.emptyTitle')}
          description={t('tasks:board.emptyDescription')}
        />
      ) : (
        <SectionList
          sections={sectionList}
          keyExtractor={(task) => task.id}
          renderSectionHeader={({ section }) => (
            <SectionHeader title={section.title} count={section.data.length} />
          )}
          renderItem={({ item }) => renderRow(item)}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={tasksQuery.isFetching}
              onRefresh={() => void tasksQuery.refetch()}
            />
          }
        />
      )}

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        color={theme.colors.onPrimary}
        onPress={() => router.push({ pathname: '/family/task/new', params: { familyId } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
});
