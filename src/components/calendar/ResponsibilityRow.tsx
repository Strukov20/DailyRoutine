import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import type { FamilyMember } from '@/domain/family/types';
import type { FamilyResponsibilityItem } from '@/domain/calendar/types';
import { formatEventTimeLabel } from '@/domain/calendar/dateUtils';
import { useAppTheme } from '@/theme';

interface ResponsibilityRowProps {
  responsibility: FamilyResponsibilityItem;
  members: FamilyMember[];
  currentProfileId: string;
  currentMemberId: string | null;
  isBusy: boolean;
  disabled?: boolean;
  onTake: () => void;
  onAccept: () => void;
  onDecline: () => void;
}

const TYPE_LABEL_KEY: Record<string, string> = {
  drop_off: 'dropOff',
  pick_up: 'pickUp',
  supervise: 'supervise',
};

/**
 * A single drop-off/pick-up/etc. responsibility row on the Family day
 * agenda — mirrors src/components/tasks/FamilyTaskRow.tsx's contextual-
 * action pattern (Take/Accept/Decline as primary buttons, not a menu).
 * Assignment/reassignment/removal are event-owner actions, reached from
 * the event editor (Section 12), not from this read-mostly agenda row.
 */
export function ResponsibilityRow({
  responsibility,
  members,
  currentProfileId: _currentProfileId,
  currentMemberId,
  isBusy,
  disabled = false,
  onTake,
  onAccept,
  onDecline,
}: ResponsibilityRowProps) {
  const { t } = useTranslation('calendar');
  const { i18n } = useTranslation();
  const theme = useAppTheme();
  const isMine = currentMemberId !== null && responsibility.assigneeMemberId === currentMemberId;
  const assignee = members.find((member) => member.id === responsibility.assigneeMemberId);
  const controlsDisabled = isBusy || disabled;
  const typeLabelKey = TYPE_LABEL_KEY[responsibility.type] ?? 'supervise';

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {formatEventTimeLabel(responsibility.dueAt, i18n.language)}
        </Text>
        <View style={styles.content}>
          <Text variant="bodyMedium">
            {t(typeLabelKey)} — {responsibility.eventTitle}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {responsibility.status === 'unassigned' && t('responsibilityUnassigned')}
            {responsibility.status === 'pending_acceptance' &&
              t('responsibilityPending', { who: isMine ? t('memberFilterMe') : (assignee?.displayName ?? '') })}
            {responsibility.status === 'accepted' &&
              t('responsibilityAccepted', { who: isMine ? t('memberFilterMe') : (assignee?.displayName ?? '') })}
            {responsibility.status === 'declined' && t('responsibilityDeclined')}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {responsibility.status === 'unassigned' ? (
          <Button
            testID={`responsibility-take-${responsibility.id}`}
            mode="contained-tonal"
            onPress={onTake}
            loading={isBusy}
            disabled={controlsDisabled}
            compact
          >
            {t('take')}
          </Button>
        ) : null}
        {isMine && responsibility.status === 'pending_acceptance' ? (
          <>
            <Button
              testID={`responsibility-accept-${responsibility.id}`}
              mode="contained"
              onPress={onAccept}
              loading={isBusy}
              disabled={controlsDisabled}
              compact
            >
              {t('accept')}
            </Button>
            <Button
              testID={`responsibility-decline-${responsibility.id}`}
              mode="outlined"
              onPress={onDecline}
              disabled={controlsDisabled}
              compact
            >
              {t('decline')}
            </Button>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  content: {
    flex: 1,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
});
