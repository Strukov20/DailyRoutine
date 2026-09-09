import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Chip, FAB, IconButton, SegmentedButtons, Text } from 'react-native-paper';

import { ResponsibilityRow } from '@/components/calendar/ResponsibilityRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { SyncStatusIndicator } from '@/components/ui/SyncStatusIndicator';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import {
  useAcceptEventResponsibility,
  useDeclineEventResponsibility,
  useFamilyDayResponsibilities,
  useFamilyDaySchedule,
  useOwnDayEvents,
  useScheduleConflict,
  useTakeEventResponsibility,
} from '@/domain/calendar/hooks';
import { addLocalDays, formatEventDateLabel, formatEventTimeLabel, localDayBoundsUtc } from '@/domain/calendar/dateUtils';
import { useActiveFamily, useFamilyMembers } from '@/domain/family/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useAppTheme } from '@/theme';

type CalendarMode = 'personal' | 'family';

/**
 * The MVP Day Calendar (Section 12) — Personal/Family mode toggle, date
 * navigation, and (in Family mode) a per-member filter, doubling as "Family
 * Today" when the selected day is today. A separate screen was deliberately
 * not built for Family Today — it is this same screen, Family mode,
 * defaulted to today, rather than a near-duplicate view (see
 * docs/DECISIONS.md, "Phase 7").
 */
export default function CalendarScreen() {
  const { t, i18n } = useTranslation('calendar');
  const theme = useAppTheme();
  const { profile } = useAuth();
  const activeFamilyQuery = useActiveFamily();
  const familyId = activeFamilyQuery.activeFamily?.id ?? null;
  const familyMembersQuery = useFamilyMembers(familyId);
  const members = (familyMembersQuery.data ?? []).filter((member) => !member.removedAt);
  const currentMember = members.find((member) => member.profileId === profile?.id);

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [mode, setMode] = useState<CalendarMode>('personal');
  const [memberFilter, setMemberFilter] = useState<string>('all');

  const { startUtc, endUtc } = localDayBoundsUtc(
    selectedDate.getFullYear(),
    selectedDate.getMonth() + 1,
    selectedDate.getDate(),
  );

  const ownEventsQuery = useOwnDayEvents(startUtc, endUtc);
  const familyScheduleQuery = useFamilyDaySchedule(mode === 'family' ? familyId : null, startUtc, endUtc);
  const familyResponsibilitiesQuery = useFamilyDayResponsibilities(mode === 'family' ? familyId : null, startUtc, endUtc);

  const takeResponsibility = useTakeEventResponsibility(familyId ?? '');
  const acceptResponsibility = useAcceptEventResponsibility(familyId ?? '');
  const declineResponsibility = useDeclineEventResponsibility(familyId ?? '');

  const currentProfileId = profile?.id ?? null;
  const currentMemberId = currentMember?.id ?? null;

  // No manual useMemo here — these are cheap array filters, and this
  // project's React Compiler handles memoization automatically; a
  // hand-written dependency array on a value derived via .find() each
  // render (like currentMemberId) is exactly what the compiler's own
  // `react-hooks/preserve-manual-memoization` rule flags as unsafe to trust.
  const familySchedule = familyScheduleQuery.data ?? [];
  const filteredFamilySchedule =
    memberFilter === 'all'
      ? familySchedule
      : memberFilter === 'me'
        ? familySchedule.filter((item) => item.ownerProfileId === currentProfileId)
        : familySchedule.filter((item) => item.participantMemberId === memberFilter);

  const familyResponsibilities = familyResponsibilitiesQuery.data ?? [];
  const filteredResponsibilities =
    memberFilter === 'all'
      ? familyResponsibilities
      : memberFilter === 'me'
        ? familyResponsibilities.filter((item) => item.assigneeMemberId === currentMemberId)
        : familyResponsibilities.filter((item) => item.assigneeMemberId === memberFilter);

  const isLoading =
    mode === 'personal'
      ? ownEventsQuery.isLoading
      : familyScheduleQuery.isLoading || familyResponsibilitiesQuery.isLoading;
  const isError =
    mode === 'personal'
      ? ownEventsQuery.isError
      : familyScheduleQuery.isError || familyResponsibilitiesQuery.isError;

  const hasContent =
    mode === 'personal'
      ? (ownEventsQuery.data ?? []).length > 0
      : filteredFamilySchedule.length > 0 || filteredResponsibilities.length > 0;

  const isRefreshing =
    mode === 'personal' ? ownEventsQuery.isFetching : familyScheduleQuery.isFetching || familyResponsibilitiesQuery.isFetching;
  const onRefresh = () => {
    if (mode === 'personal') {
      void ownEventsQuery.refetch();
    } else {
      void familyScheduleQuery.refetch();
      void familyResponsibilitiesQuery.refetch();
    }
  };

  return (
    <ScreenContainer>
      <OfflineBanner />
      <SyncStatusIndicator />
      <View style={styles.header}>
        <IconButton
          icon="chevron-left"
          accessibilityLabel={t('previousDay')}
          onPress={() => setSelectedDate((d) => addLocalDays(d, -1))}
        />
        <View style={styles.dateLabel}>
          <Text variant="titleMedium">{formatEventDateLabel(selectedDate.toISOString(), i18n.language)}</Text>
        </View>
        <IconButton
          icon="chevron-right"
          accessibilityLabel={t('nextDay')}
          onPress={() => setSelectedDate((d) => addLocalDays(d, 1))}
        />
      </View>

      <Chip icon="calendar-today" onPress={() => setSelectedDate(new Date())} style={styles.todayChip}>
        {t('today')}
      </Chip>

      <SegmentedButtons
        value={mode}
        onValueChange={(value) => setMode(value as CalendarMode)}
        style={styles.segmented}
        buttons={[
          { value: 'personal', label: t('modePersonal') },
          { value: 'family', label: t('modeFamily'), disabled: !familyId },
        ]}
      />

      {mode === 'family' && familyId ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.memberFilterRow}>
          <Chip selected={memberFilter === 'all'} onPress={() => setMemberFilter('all')} style={styles.filterChip}>
            {t('memberFilterAll')}
          </Chip>
          <Chip selected={memberFilter === 'me'} onPress={() => setMemberFilter('me')} style={styles.filterChip}>
            {t('memberFilterMe')}
          </Chip>
          {members.map((member) => (
            <Chip
              key={member.id}
              selected={memberFilter === member.id}
              onPress={() => setMemberFilter(member.id)}
              style={styles.filterChip}
            >
              {member.displayName}
            </Chip>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        {isLoading ? <LoadingState /> : null}
        {isError ? <ErrorState onRetry={onRefresh} /> : null}
        {!isLoading && !isError && !hasContent ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
        ) : null}

        {!isLoading && !isError && mode === 'personal'
          ? (ownEventsQuery.data ?? []).map((event) => (
              <AgendaEventRow
                key={event.id}
                title={event.title}
                startsAt={event.startsAt}
                endsAt={event.endsAt}
                onPress={() => router.push(`/event/${event.id}` as Href)}
              />
            ))
          : null}

        {!isLoading && !isError && mode === 'family'
          ? filteredFamilySchedule.map((item) => (
              <AgendaEventRow
                key={item.id}
                title={item.title ?? t('busy')}
                startsAt={item.startsAt}
                endsAt={item.endsAt}
                busy={item.title === null}
                onPress={item.title === null ? undefined : () => router.push(`/event/${item.id}` as Href)}
              />
            ))
          : null}

        {!isLoading && !isError && mode === 'family' && filteredResponsibilities.length > 0 ? (
          <View style={styles.responsibilitiesSection}>
            {filteredResponsibilities.map((responsibility) => (
              <ResponsibilityConflictAwareRow
                key={responsibility.id}
                responsibility={responsibility}
                members={members}
                currentProfileId={profile?.id ?? ''}
                currentMemberId={currentMember?.id ?? null}
                isBusy={takeResponsibility.isPending || acceptResponsibility.isPending || declineResponsibility.isPending}
                onTake={() => takeResponsibility.mutate(responsibility.id)}
                onAccept={() => acceptResponsibility.mutate(responsibility.id)}
                onDecline={() => declineResponsibility.mutate(responsibility.id)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <FAB
        testID="calendar-new-event-fab"
        icon="plus"
        accessibilityLabel={t('editor.createTitle')}
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() =>
          router.push(
            (mode === 'family' && familyId ? `/event/new?familyId=${familyId}` : '/event/new') as Href,
          )
        }
      />
    </ScreenContainer>
  );
}

function AgendaEventRow({
  title,
  startsAt,
  endsAt,
  busy = false,
  onPress,
}: {
  title: string;
  startsAt: string;
  endsAt: string;
  busy?: boolean;
  onPress?: () => void;
}) {
  const { i18n } = useTranslation();
  const theme = useAppTheme();
  return (
    <Pressable
      style={styles.eventRow}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {formatEventTimeLabel(startsAt, i18n.language)}–{formatEventTimeLabel(endsAt, i18n.language)}
      </Text>
      <Text variant="bodyMedium" style={busy ? { color: theme.colors.onSurfaceVariant } : undefined}>
        {title}
      </Text>
    </Pressable>
  );
}

/** Wraps ResponsibilityRow with a live conflict check for its assignee, shown as a warning. */
function ResponsibilityConflictAwareRow(props: Parameters<typeof ResponsibilityRow>[0]) {
  const { t } = useTranslation('calendar');
  const theme = useAppTheme();
  const { responsibility, members } = props;
  const conflictQuery = useScheduleConflict(
    responsibility.status === 'accepted' ? responsibility.assigneeMemberId : null,
    responsibility.dueAt,
    responsibility.dueAt,
    responsibility.id,
  );
  const assignee = members.find((member) => member.id === responsibility.assigneeMemberId);

  return (
    <View>
      <ResponsibilityRow {...props} />
      {conflictQuery.data ? (
        <Text variant="bodySmall" style={[styles.warning, { color: theme.colors.danger }]}>
          {t('conflictGeneric', { name: assignee?.displayName ?? '' })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateLabel: {
    flex: 1,
    alignItems: 'center',
  },
  todayChip: {
    alignSelf: 'center',
    marginBottom: 8,
  },
  segmented: {
    marginBottom: 8,
  },
  memberFilterRow: {
    marginBottom: 8,
  },
  filterChip: {
    marginRight: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 96,
  },
  eventRow: {
    paddingVertical: 10,
    gap: 2,
  },
  responsibilitiesSection: {
    marginTop: 16,
  },
  warning: {
    marginTop: -4,
    marginBottom: 8,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
});
