import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EventEditorForm } from '@/components/calendar/EventEditorForm';
import { ScreenContainer } from '@/components/ui/ScreenContainer';

/**
 * Create-event entry point — reached from the Calendar Day view's FAB
 * (both Personal and Family modes). An optional `familyId` param seeds a
 * Family/Child-kind creation when opened from the Family day view; absent,
 * the form starts on Personal (see EventEditorForm's own kind switch).
 */
export default function NewEventScreen() {
  const { t } = useTranslation('calendar');
  const { familyId } = useLocalSearchParams<{ familyId?: string }>();

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('editor.createTitle') }} />
      <EventEditorForm mode="create" defaultFamilyId={familyId ?? null} onDone={() => router.back()} />
    </ScreenContainer>
  );
}
