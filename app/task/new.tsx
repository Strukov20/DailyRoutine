import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { TaskEditorForm } from '@/components/tasks/TaskEditorForm';
import { ScreenContainer } from '@/components/ui/ScreenContainer';

/**
 * Full create-task entry point (title required, everything else optional —
 * see docs/DATA_MODEL.md). An optional `date` query param pre-fills the
 * schedule for "create directly for Today/Tomorrow" (Inbox/Today/Tomorrow
 * FABs — see app/(app)/today.tsx, tomorrow.tsx, inbox.tsx).
 */
export default function NewTaskScreen() {
  const { t } = useTranslation('tasks');
  const { date } = useLocalSearchParams<{ date?: string }>();

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('editor.createTitle') }} />
      <TaskEditorForm
        mode="create"
        initialValues={{ title: '', date, priority: 'normal', visibility: 'private' }}
        onDone={() => router.back()}
      />
    </ScreenContainer>
  );
}
