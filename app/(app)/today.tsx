import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, FAB, Text } from 'react-native-paper';

import { QuickAddInput } from '@/components/tasks/QuickAddInput';
import { TaskSectionList } from '@/components/tasks/TaskSectionList';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { SyncStatusIndicator } from '@/components/ui/SyncStatusIndicator';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useCategories } from '@/domain/categories/hooks';
import {
  useCompleteOccurrence,
  useRescheduleOccurrence,
  useRestoreOccurrence,
  useSkipOccurrence,
} from '@/domain/recurrence/hooks';
import { todayDateString, tomorrowDateString } from '@/domain/tasks/dateUtils';
import {
  useCompletePersonalTask,
  useDeletePersonalTask,
  useMoveTaskToInbox,
  useRestorePersonalTask,
  useSchedulePersonalTask,
  useTodaySections,
} from '@/domain/tasks/hooks';
import type { Task } from '@/domain/tasks/types';
import { useAppTheme } from '@/theme';

export default function TodayScreen() {
  const { t } = useTranslation(['tasks', 'screens']);
  const theme = useAppTheme();
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);

  const { sections, isLoading, isError, refetch } = useTodaySections();
  const categoriesQuery = useCategories();
  const completeTask = useCompletePersonalTask();
  const restoreTask = useRestorePersonalTask();
  const scheduleTask = useSchedulePersonalTask();
  const moveToInbox = useMoveTaskToInbox();
  const deleteTask = useDeletePersonalTask();
  const completeOccurrence = useCompleteOccurrence();
  const restoreOccurrence = useRestoreOccurrence();
  const rescheduleOccurrence = useRescheduleOccurrence();
  const skipOccurrence = useSkipOccurrence();

  if (isLoading) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (isError) {
    return (
      <ScreenContainer>
        <ErrorState onRetry={refetch} />
      </ScreenContainer>
    );
  }

  const categoriesById = Object.fromEntries((categoriesQuery.data ?? []).map((c) => [c.id, c]));

  const onToggleComplete = async (task: Task) => {
    setTogglingTaskId(task.id);
    try {
      if (task.occurrenceId) {
        await (task.completedAt
          ? restoreOccurrence.mutateAsync(task.occurrenceId)
          : completeOccurrence.mutateAsync(task.occurrenceId));
      } else {
        await (task.completedAt
          ? restoreTask.mutateAsync(task.id)
          : completeTask.mutateAsync(task.id));
      }
    } finally {
      setTogglingTaskId(null);
    }
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text variant="headlineSmall" style={styles.title}>
            {t('screens:today.title')}
          </Text>
          <Button mode="text" icon="calendar-arrow-right" onPress={() => router.push('/tomorrow')}>
            {t('screens:today.tomorrowLink')}
          </Button>
        </View>
        <OfflineBanner />
        <SyncStatusIndicator />
        <QuickAddInput date={todayDateString()} screenId="today" />
      </View>

      <TaskSectionList
        sections={[
          {
            key: 'overdue',
            title: t('tasks:sections.overdue'),
            data: sections.overdue,
            showOverdue: true,
          },
          { key: 'timed', title: t('tasks:sections.timed'), data: sections.timed },
          { key: 'anytime', title: t('tasks:sections.anytime'), data: sections.anytime },
          { key: 'completed', title: t('tasks:sections.completed'), data: sections.completed },
        ]}
        categoriesById={categoriesById}
        onToggleComplete={(task) => void onToggleComplete(task)}
        togglingTaskId={togglingTaskId}
        onEdit={(task) =>
          router.push({ pathname: '/task/[id]/edit', params: { id: task.seriesTaskId ?? task.id } })
        }
        onMoveToTomorrow={(task) =>
          task.occurrenceId
            ? void rescheduleOccurrence.mutateAsync({
                occurrenceId: task.occurrenceId,
                date: tomorrowDateString(),
              })
            : void scheduleTask.mutateAsync({ taskId: task.id, date: tomorrowDateString() })
        }
        onMoveToInbox={(task) => void moveToInbox.mutateAsync(task.id)}
        onArchive={(task) =>
          task.occurrenceId
            ? void skipOccurrence.mutateAsync(task.occurrenceId)
            : void deleteTask.mutateAsync(task.id)
        }
        emptyTitle={t('screens:today.emptyTitle')}
        emptyDescription={t('screens:today.emptyDescription')}
      />

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        color={theme.colors.onPrimary}
        onPress={() => router.push({ pathname: '/task/new', params: { date: todayDateString() } })}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
