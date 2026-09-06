import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { TaskEditorForm } from '@/components/tasks/TaskEditorForm';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useTask } from '@/domain/tasks/hooks';

export default function EditTaskScreen() {
  const { t } = useTranslation('tasks');
  const { id } = useLocalSearchParams<{ id: string }>();
  const taskQuery = useTask(id ?? null);

  if (taskQuery.isLoading) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: t('editor.editTitle') }} />
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (taskQuery.isError || !taskQuery.data) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: t('editor.editTitle') }} />
        <ErrorState title={t('editor.notFound')} />
      </ScreenContainer>
    );
  }

  const task = taskQuery.data;

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('editor.editTitle') }} />
      <TaskEditorForm
        mode="edit"
        taskId={task.id}
        initialValues={{
          title: task.title,
          description: task.description ?? undefined,
          date: task.date ?? undefined,
          startTime: task.startTime ?? undefined,
          durationMinutes: task.durationMinutes ?? undefined,
          priority: task.priority,
          categoryId: task.categoryId ?? undefined,
          visibility: task.visibility,
        }}
        sharedFamilyId={task.visibility === 'family' ? (task.familyId ?? undefined) : undefined}
        onDone={() => router.back()}
      />
    </ScreenContainer>
  );
}
