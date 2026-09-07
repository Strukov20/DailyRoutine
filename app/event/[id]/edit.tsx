import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';

import { EventEditorForm } from '@/components/calendar/EventEditorForm';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useCancelEvent, useEvent } from '@/domain/calendar/hooks';
import { formatTimeOnly } from '@/domain/tasks/dateUtils';
import { useAppTheme } from '@/theme';

export default function EditEventScreen() {
  const { t } = useTranslation(['calendar', 'common']);
  const theme = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventQuery = useEvent(id ?? null);
  const event = eventQuery.data;
  const cancelEvent = useCancelEvent(event?.familyId ?? undefined);

  if (eventQuery.isLoading) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: t('calendar:editor.editTitle') }} />
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (eventQuery.isError || !event) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: t('calendar:editor.editTitle') }} />
        <ErrorState title={t('calendar:editor.notFound')} />
      </ScreenContainer>
    );
  }

  const onCancelEvent = () => {
    Alert.alert(t('calendar:editor.cancelConfirmTitle'), t('calendar:editor.cancelConfirmMessage'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('calendar:editor.cancel'),
        style: 'destructive',
        onPress: () => {
          cancelEvent.mutate(event.id, { onSuccess: () => router.back() });
        },
      },
    ]);
  };

  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const dateStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('calendar:editor.editTitle') }} />
      <EventEditorForm
        mode="edit"
        eventId={event.id}
        defaultFamilyId={event.familyId}
        initialValues={{
          kind: event.familyId ? 'family' : 'personal',
          title: event.title,
          description: event.description ?? undefined,
          location: event.location ?? undefined,
          date: dateStr,
          startTime: formatTimeOnly(start),
          endTime: formatTimeOnly(end),
          visibility: event.visibility,
          familyId: event.familyId ?? undefined,
        }}
        onDone={() => router.back()}
      />
      <Button
        testID="event-editor-cancel-event"
        mode="text"
        textColor={theme.colors.danger}
        onPress={onCancelEvent}
        loading={cancelEvent.isPending}
        style={styles.cancelButton}
      >
        {t('calendar:editor.cancel')}
      </Button>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  cancelButton: {
    marginTop: 8,
  },
});
