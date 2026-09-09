import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import { formatEventDateLabel, formatEventTimeLabel } from '@/domain/calendar/dateUtils';
import { getSyncIssueStatusLabel } from '@/lib/offline/syncIssueDisplay';
import type { OfflineOperation } from '@/lib/offline/types';
import type { UpdatePersonalTaskParams } from '@/lib/tasks/taskService';
import { useAppTheme } from '@/theme';

interface SyncIssueCardProps {
  operation: OfflineOperation;
  locale: string;
  onRetry: (operationId: string) => void;
  onDiscard: (operationId: string) => void;
  isBusy: boolean;
}

/** A queued create/update's own local title (this device's own not-yet-sent value) — never another user's content, always safe to show. Falls back to a generic per-operation-type label otherwise. */
function resolveIssueTitle(
  operation: OfflineOperation,
  t: ReturnType<typeof useTranslation<'syncIssues'>>['t'],
): string {
  if (operation.operationType === 'create_personal_task' || operation.operationType === 'update_personal_task') {
    const payload = operation.payload as { title?: string } | UpdatePersonalTaskParams;
    if (payload.title) return payload.title;
  }
  return t(`operationType.${operation.operationType}`);
}

const STATUS_COLOR_KEY: Record<ReturnType<typeof getSyncIssueStatusLabel>, 'warning' | 'danger'> = {
  waitingToRetry: 'warning',
  needsReview: 'danger',
  cannotSync: 'danger',
  taskGone: 'danger',
};

/** One Sync Issues list card (Section 2) — only ever safe, user-facing fields: never a raw Postgres error, stack trace, RPC payload, auth/session data, internal SQL name, token, or secret. */
export function SyncIssueCard({ operation, locale, onRetry, onDiscard, isBusy }: SyncIssueCardProps) {
  const { t } = useTranslation('syncIssues');
  const theme = useAppTheme();

  const statusLabel = getSyncIssueStatusLabel(operation);
  const statusColor = theme.colors[STATUS_COLOR_KEY[statusLabel]];
  const title = resolveIssueTitle(operation, t);
  const operationTypeLabel = t(`operationType.${operation.operationType}`);
  const reasonText = operation.lastSafeErrorCode ? t(`reason.${operation.lastSafeErrorCode}`) : null;
  const queuedAt = t('queuedAt', {
    time: `${formatEventDateLabel(operation.createdAt, locale)} ${formatEventTimeLabel(operation.createdAt, locale)}`,
  });

  const isRetryWait = operation.status === 'retry_wait';
  const isConflict = operation.status === 'conflict';
  const canDiscard = operation.status !== 'syncing';

  const accessibilityLabel = `${operationTypeLabel}, ${title}, ${t(`status.${statusLabel}`)}${
    reasonText ? `, ${reasonText}` : ''
  }`;

  return (
    <View
      style={[styles.card, { borderColor: theme.colors.outline }]}
      accessible
      accessibilityLabel={accessibilityLabel}
      testID={`sync-issue-card-${operation.operationId}`}
    >
      <View style={styles.headerRow}>
        <Icon
          source={isConflict ? 'source-branch-sync' : isRetryWait ? 'cloud-sync-outline' : 'cloud-alert-outline'}
          size={18}
          color={statusColor}
        />
        <View style={styles.headerText}>
          <Text variant="labelLarge">{title}</Text>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {operationTypeLabel} · {queuedAt}
          </Text>
        </View>
      </View>

      <Text variant="labelMedium" style={{ color: statusColor }}>
        {t(`status.${statusLabel}`)}
      </Text>
      {reasonText ? (
        <Text variant="bodySmall" style={styles.reason}>
          {reasonText}
        </Text>
      ) : null}

      <View style={styles.actionsRow}>
        {(isRetryWait || isConflict) && (
          <Button
            mode="text"
            compact
            testID={`sync-issue-review-${operation.operationId}`}
            onPress={() => router.push(`/sync-issues/${operation.operationId}` as Href)}
          >
            {t(isConflict ? 'actions.reviewChanges' : 'actions.reviewPendingChange')}
          </Button>
        )}
        {isRetryWait && (
          <Button
            mode="text"
            compact
            disabled={isBusy}
            accessibilityState={{ disabled: isBusy, busy: isBusy }}
            testID={`sync-issue-retry-${operation.operationId}`}
            onPress={() => onRetry(operation.operationId)}
          >
            {t('actions.retry')}
          </Button>
        )}
        {canDiscard && (
          <Button
            mode="text"
            compact
            disabled={isBusy}
            accessibilityState={{ disabled: isBusy, busy: isBusy }}
            testID={`sync-issue-discard-${operation.operationId}`}
            onPress={() => onDiscard(operation.operationId)}
          >
            {t(operation.lastSafeErrorCode === 'task_unavailable' ? 'actions.discardLocalChange' : 'actions.discardMyChange')}
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  reason: {
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    marginHorizontal: -8,
  },
});
