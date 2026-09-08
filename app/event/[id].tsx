import { Stack, router, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { formatEventDateLabel, formatEventTimeLabel } from '@/domain/calendar/dateUtils';
import {
  useAcceptEventResponsibility,
  useDeclineEventResponsibility,
  useEvent,
  useEventResponsibilities,
  useTakeEventResponsibility,
} from '@/domain/calendar/hooks';
import { useFamilyMembers } from '@/domain/family/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { ResponsibilityRow } from '@/components/calendar/ResponsibilityRow';
import { useAppTheme } from '@/theme';

/**
 * Event detail — the notification-tap destination for both task-assignment
 * (indirectly, via the task edit route) and event-responsibility taps (see
 * src/lib/notifications/notificationResponseRouter.ts). A no-longer-
 * authorized or deleted event naturally resolves to `useEvent` returning
 * `null` (RLS/soft-delete exclude it at the query level) — rendered as a
 * friendly ErrorState here, never a raw fetch failure.
 */
export default function EventDetailScreen() {
  const { t, i18n } = useTranslation(['calendar', 'common']);
  const theme = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const eventQuery = useEvent(id ?? null);
  const event = eventQuery.data;
  const responsibilitiesQuery = useEventResponsibilities(id ?? null);
  const familyMembersQuery = useFamilyMembers(event?.familyId ?? null);
  const members = familyMembersQuery.data ?? [];
  const currentMember = members.find((member) => member.profileId === profile?.id);

  const takeResponsibility = useTakeEventResponsibility(event?.familyId ?? '');
  const acceptResponsibility = useAcceptEventResponsibility(event?.familyId ?? '');
  const declineResponsibility = useDeclineEventResponsibility(event?.familyId ?? '');

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

  const isOwner = event.ownerProfileId === profile?.id;
  // Reuses the same responsibilities query's rows for the /event/[id]/edit
  // form's own read via useEvent — this screen renders the raw
  // (unsanitized-by-view) responsibilities table read, which is safe here
  // because base-table RLS already guarantees the caller can only reach
  // this far for an event they're authorized to see.
  const responsibilities = responsibilitiesQuery.data ?? [];

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: event.title }} />
      <Text variant="headlineSmall">{event.title}</Text>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
        {formatEventDateLabel(event.startsAt, i18n.language)} ·{' '}
        {formatEventTimeLabel(event.startsAt, i18n.language)}–{formatEventTimeLabel(event.endsAt, i18n.language)}
      </Text>
      {event.location ? (
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {event.location}
        </Text>
      ) : null}
      {event.description ? <Text style={styles.description}>{event.description}</Text> : null}

      {responsibilities.length > 0 ? (
        <View style={styles.responsibilities}>
          {responsibilities.map((responsibility) => (
            <ResponsibilityRow
              key={responsibility.id}
              responsibility={{
                ...responsibility,
                eventId: event.id,
                eventStartsAt: event.startsAt,
                eventEndsAt: event.endsAt,
                eventTitle: event.title,
                dueAt: responsibility.type === 'drop_off' ? event.startsAt : event.endsAt,
              }}
              members={members}
              currentProfileId={profile?.id ?? ''}
              currentMemberId={currentMember?.id ?? null}
              isBusy={
                takeResponsibility.isPending || acceptResponsibility.isPending || declineResponsibility.isPending
              }
              onTake={() => takeResponsibility.mutate(responsibility.id)}
              onAccept={() => acceptResponsibility.mutate(responsibility.id)}
              onDecline={() => declineResponsibility.mutate(responsibility.id)}
            />
          ))}
        </View>
      ) : null}

      {isOwner ? (
        <Button mode="outlined" style={styles.editButton} onPress={() => router.push(`/event/${event.id}/edit` as Href)}>
          {t('common:actions.edit')}
        </Button>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  description: {
    marginTop: 12,
  },
  responsibilities: {
    marginTop: 20,
  },
  editButton: {
    marginTop: 24,
  },
});
