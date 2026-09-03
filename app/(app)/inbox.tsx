import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { FAB, Text } from 'react-native-paper';

import { QuickAddInput } from '@/components/tasks/QuickAddInput';
import { TaskSectionList } from '@/components/tasks/TaskSectionList';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useCategories } from '@/domain/categories/hooks';
import { todayDateString, tomorrowDateString } from '@/domain/tasks/dateUtils';
import {
  useCompletePersonalTask,
  useDeletePersonalTask,
  useInboxTasks,
  useRestorePersonalTask,
  useSchedulePersonalTask,
} from '@/domain/tasks/hooks';
import { buildDaySections } from '@/domain/tasks/sections';
import type { Task } from '@/domain/tasks/types';
import { useAppTheme } from '@/theme';

export default function InboxScreen() {
  const { t } = useTranslation(['tasks', 'screens']);
  const theme = useAppTheme();
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);

  const inboxQuery = useInboxTasks();
  const categoriesQuery = useCategories();
  const completeTask = useCompletePersonalTask();
  const restoreTask = useRestorePersonalTask();
  const scheduleTask = useSchedulePersonalTask();
  const deleteTask = useDeletePersonalTask();

  if (inboxQuery.isLoading) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (inboxQuery.isError) {
    return (
      <ScreenContainer>
        <ErrorState onRetry={() => void inboxQuery.refetch()} />
      </ScreenContainer>
    );
  }

  const tasks = inboxQuery.data ?? [];
  const { anytime, completed } = buildDaySections(tasks);
  const categoriesById = Object.fromEntries((categoriesQuery.data ?? []).map((c) => [c.id, c]));

  const onToggleComplete = async (task: Task) => {
    setTogglingTaskId(task.id);
    try {
      await (task.completedAt ? restoreTask.mutateAsync(task.id) : completeTask.mutateAsync(task.id));
    } finally {
      setTogglingTaskId(null);
    }
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.header}>
        <Text variant="headlineSmall" style={styles.title}>
          {t('screens:inbox.title')}
        </Text>
        <OfflineBanner />
        <QuickAddInput />
      </View>

      <TaskSectionList
        sections={[
          { key: 'anytime', title: t('tasks:sections.tasks'), data: anytime },
          { key: 'completed', title: t('tasks:sections.completed'), data: completed },
        ]}
        categoriesById={categoriesById}
        onToggleComplete={(task) => void onToggleComplete(task)}
        togglingTaskId={togglingTaskId}
        onEdit={(task) => router.push({ pathname: '/task/[id]/edit', params: { id: task.id } })}
        onMoveToToday={(task) =>
          void scheduleTask.mutateAsync({ taskId: task.id, date: todayDateString() })
        }
        onMoveToTomorrow={(task) =>
          void scheduleTask.mutateAsync({ taskId: task.id, date: tomorrowDateString() })
        }
        onArchive={(task) => void deleteTask.mutateAsync(task.id)}
        emptyTitle={t('screens:inbox.emptyTitle')}
        emptyDescription={t('screens:inbox.emptyDescription')}
      />

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        color={theme.colors.onPrimary}
        onPress={() => router.push('/task/new')}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: {
    marginBottom: 8,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
});
