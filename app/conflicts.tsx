import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { ConflictRow } from '@/components/conflicts/ConflictRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { addLocalDays, dayBoundsUtcFor } from '@/domain/calendar/dateUtils';
import { useFamilyConflicts } from '@/domain/conflicts/hooks';
import { useActiveFamily, useFamilyMembers } from '@/domain/family/hooks';
import { todayDateString } from '@/domain/tasks/dateUtils';
import { useIsOffline } from '@/lib/query/useIsOffline';
import { useAppTheme } from '@/theme';

/** Section 15's own "bounded range" for "upcoming" — today plus the next 7 days, not an unbounded future scan. */
const UPCOMING_WINDOW_DAYS = 7;

/**
 * The Conflict Center (Phase 9, Section 15) — every current conflict for
 * the active family, grouped Today / Upcoming, each row backed entirely by
 * `list_family_conflicts`'s own privacy-redacted output (see
 * ConflictRow.tsx). Deliberately read-only beyond the per-row Review
 * action: no automatic fixes, no AI suggestions, no dismiss-forever, no
 * hidden schedule changes (Section 15's own explicit non-goals).
 */
export default function ConflictsScreen() {
  const { t } = useTranslation('conflicts');
  const theme = useAppTheme();
  const isOffline = useIsOffline();

  const activeFamilyQuery = useActiveFamily();
  const familyId = activeFamilyQuery.activeFamily?.id ?? null;
  const familyMembersQuery = useFamilyMembers(familyId);
  const members = familyMembersQuery.data ?? [];

  const todayBounds = dayBoundsUtcFor(new Date());
  const upcomingBounds = dayBoundsUtcFor(addLocalDays(new Date(), UPCOMING_WINDOW_DAYS));

  const conflictsQuery = useFamilyConflicts(familyId, todayBounds.startUtc, upcomingBounds.endUtc);
  const conflicts = conflictsQuery.data ?? [];

  const today = todayDateString();
  const todayConflicts = conflicts.filter((conflict) => conflict.conflictDate === today);
  const upcomingConflicts = conflicts.filter((conflict) => conflict.conflictDate !== today);

  if (conflictsQuery.isLoading) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (conflictsQuery.isError) {
    return (
      <ScreenContainer>
        <ErrorState onRetry={() => void conflictsQuery.refetch()} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <OfflineBanner />
      {isOffline && conflicts.length > 0 ? (
        <Text variant="labelSmall" style={[styles.offlineNote, { color: theme.colors.onSurfaceVariant }]}>
          {t('offlineStale')}
        </Text>
      ) : null}

      {conflicts.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl refreshing={conflictsQuery.isFetching} onRefresh={() => void conflictsQuery.refetch()} />
          }
        >
          {todayConflicts.length > 0 ? (
            <View style={styles.section}>
              <Text variant="titleSmall" style={styles.sectionTitle}>
                {t('sections.today')}
              </Text>
              {todayConflicts.map((conflict) => (
                <ConflictRow key={conflict.conflictId} conflict={conflict} members={members} />
              ))}
            </View>
          ) : null}

          {upcomingConflicts.length > 0 ? (
            <View style={styles.section}>
              <Text variant="titleSmall" style={styles.sectionTitle}>
                {t('sections.upcoming')}
              </Text>
              {upcomingConflicts.map((conflict) => (
                <ConflictRow key={conflict.conflictId} conflict={conflict} members={members} />
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  offlineNote: {
    marginBottom: 8,
  },
});
