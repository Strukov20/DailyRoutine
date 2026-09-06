import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { TaskEditorForm } from '@/components/tasks/TaskEditorForm';
import { ScreenContainer } from '@/components/ui/ScreenContainer';

/**
 * Create-a-shared-task entry point (Phase 5, Section 10) — reached from the
 * Family task board's FAB (see src/components/tasks/FamilyTaskBoard.tsx).
 * `familyId` comes from the board's own active family, never from an
 * arbitrary client-editable field. TaskEditorForm's `sharedFamilyId` prop
 * takes care of forcing Family visibility and offering the optional Adult
 * assignee.
 */
export default function NewFamilyTaskScreen() {
  const { t } = useTranslation('tasks');
  const { familyId } = useLocalSearchParams<{ familyId: string }>();

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('editor.createSharedTitle') }} />
      <TaskEditorForm
        mode="create"
        sharedFamilyId={familyId}
        initialValues={{ title: '', priority: 'normal', visibility: 'family' }}
        onDone={() => router.back()}
      />
    </ScreenContainer>
  );
}
