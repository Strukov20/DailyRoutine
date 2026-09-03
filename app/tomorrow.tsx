import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { FAB } from 'react-native-paper';

import { QuickAddInput } from '@/components/tasks/QuickAddInput';
import { TaskSectionList } from '@/components/tasks/TaskSectionList';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useCategories } from '@/domain/categories/hooks';
import { tomorrowDateString } from '@/domain/tasks/dateUtils';
import {
  useCompletePersonalTask,
  useDeletePersonalTask,
  useMoveTaskToInbox,
  useRestorePersonalTask,
  useTomorrowSections,
} from '@/domain/tasks/hooks';
import type { Task } from '@/domain/tasks/types';
import { useAppTheme } from '@/theme';

/**
 * A nested, top-level route (not a bottom-nav tab — see docs/PRODUCT.md,
 * "do not add a tab without a strong UX reason") reachable from
 * app/(app)/today.tsx's header action.
 */
export default function TomorrowScreen() {
  const { t } = useTranslation(['tasks', 'screens']);
  const theme = useAppTheme();
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  const tomorrow = tomorrowDateString();

  const { sections, isLoading, isError, refetch } = useTomorrowSections();
  const categoriesQuery = useCategories();
  const completeTask = useCompletePersonalTask();
  const restoreTask = useRestorePersonalTask();
  const moveToInbox = useMoveTaskToInbox();
  const deleteTask = useDeletePersonalTask();

  if (isLoading) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: t('screens:tomorrow.title'), headerShown: true }} />
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (isError) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: t('screens:tomorrow.title'), headerShown: true }} />
        <ErrorState onRetry={refetch} />
      </ScreenContainer>
    );
  }

  const categoriesById = Object.fromEntries((categoriesQuery.data ?? []).map((c) => [c.id, c]));

  const onToggleComplete = async (task: Task) => {
    setTogglingTaskId(task.id);
    try {
      await (task.completedAt
        ? restoreTask.mutateAsync(task.id)
        : completeTask.mutateAsync(task.id));
    } finally {
      setTogglingTaskId(null);
    }
  };

  return (
    <ScreenContainer noPadding>
      <Stack.Screen options={{ title: t('screens:tomorrow.title'), headerShown: true }} />
      <View style={styles.header}>
        <OfflineBanner />
        <QuickAddInput date={tomorrow} />
      </View>

      <TaskSectionList
        sections={[
          { key: 'timed', title: t('tasks:sections.timed'), data: sections.timed },
          { key: 'anytime', title: t('tasks:sections.anytime'), data: sections.anytime },
          { key: 'completed', title: t('tasks:sections.completed'), data: sections.completed },
        ]}
        categoriesById={categoriesById}
        onToggleComplete={(task) => void onToggleComplete(task)}
        togglingTaskId={togglingTaskId}
        onEdit={(task) => router.push({ pathname: '/task/[id]/edit', params: { id: task.id } })}
        onMoveToInbox={(task) => void moveToInbox.mutateAsync(task.id)}
        onArchive={(task) => void deleteTask.mutateAsync(task.id)}
        emptyTitle={t('screens:tomorrow.emptyTitle')}
        emptyDescription={t('screens:tomorrow.emptyDescription')}
      />

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        color={theme.colors.onPrimary}
        onPress={() => router.push({ pathname: '/task/new', params: { date: tomorrow } })}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
});
