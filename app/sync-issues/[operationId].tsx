import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { selectOperationById, useOfflineQueueStore } from '@/lib/offline/offlineQueueStore';
import {
  applyMyChange,
  discardSyncIssue,
  getConflictComparison,
  getLocalChangeFields,
  reloadServerSnapshot,
  retrySyncIssue,
  type ComparisonField,
} from '@/lib/offline/syncIssueResolution';
import { getSyncIssueStatusLabel, isTerminalStatus } from '@/lib/offline/syncIssueDisplay';
import { useIsOffline } from '@/lib/query/useIsOffline';
import { useAppTheme } from '@/theme';

/**
 * Section 4/5 — the Sync Issues detail/comparison screen. `operationId` is
 * the only route param (Section 9: "Do not put task contents into route
 * parameters") — every other value shown here comes from either the
 * queue's own in-memory state or a fresh, authenticated server fetch
 * scoped to just this operation's owner.
 */
export default function SyncIssueDetailScreen() {
  const { t } = useTranslation('syncIssues');
  const theme = useAppTheme();
  const isOffline = useIsOffline();
  const queryClient = useQueryClient();
  const { operationId } = useLocalSearchParams<{ operationId: string }>();
  const operation = useOfflineQueueStore((state) =>
    operationId ? selectOperationById(state, operationId) : undefined,
  );
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  // Final security/concurrency pass — true right after Apply discovers the
  // server row changed again since the user's last review (Section 5's
  // "stale review" window). Cleared on the next reload/apply attempt.
  const [staleReviewNotice, setStaleReviewNotice] = useState(false);

  const isConflict = operation?.status === 'conflict';
  const comparisonQuery = useQuery({
    queryKey: ['sync-issues', 'comparison', operationId],
    queryFn: () => getConflictComparison(operationId as string),
    enabled: Boolean(operationId) && isConflict && !isOffline,
  });

  // Section 9: a stale deep link (an operation already resolved on this
  // device, or belonging to a different account after a switch) fails
  // safely — never a crash, never another account's content.
  if (!operationId || !operation || isTerminalStatus(operation.status)) {
    return (
      <ScreenContainer>
        <EmptyState title={t('notFound.title')} description={t('notFound.description')} />
      </ScreenContainer>
    );
  }

  async function handleReload() {
    if (!operationId) return;
    setStaleReviewNotice(false);
    await reloadServerSnapshot(operationId);
    await queryClient.invalidateQueries({ queryKey: ['sync-issues', 'comparison', operationId] });
  }

  async function handleApply() {
    if (!operationId) return;
    setBusy(true);
    setStaleReviewNotice(false);
    try {
      const outcome = await applyMyChange(operationId);
      if (outcome.result === 'succeeded') {
        router.back();
        return;
      }
      if (outcome.result === 'stale_review') {
        setStaleReviewNotice(true);
      }
      // 'stale_review' and 'conflict' both leave the operation in
      // 'conflict' with a freshly-reviewed comparison already recorded —
      // refetch so the screen shows it instead of the version the user
      // originally reviewed.
      await queryClient.invalidateQueries({ queryKey: ['sync-issues', 'comparison', operationId] });
    } finally {
      setBusy(false);
      setConfirmApply(false);
    }
  }

  async function handleDiscard() {
    if (!operationId) return;
    setBusy(true);
    try {
      await discardSyncIssue(operationId);
      router.back();
    } finally {
      setBusy(false);
      setConfirmDiscard(false);
    }
  }

  async function handleRetry() {
    if (!operationId) return;
    setBusy(true);
    try {
      await retrySyncIssue(operationId);
      router.back();
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = getSyncIssueStatusLabel(operation);
  const reasonText = operation.lastSafeErrorCode ? t(`reason.${operation.lastSafeErrorCode}`) : null;

  return (
    <ScreenContainer>
      <ScrollView>
        <Text variant="titleMedium">{t(`status.${statusLabel}`)}</Text>
        {reasonText ? <Text variant="bodyMedium">{reasonText}</Text> : null}

        {staleReviewNotice ? (
          <Text
            accessibilityRole="alert"
            variant="bodySmall"
            testID="sync-issue-stale-review-notice"
            style={[styles.offlineNote, { color: theme.colors.danger }]}
          >
            {t('comparison.staleReview')}
          </Text>
        ) : null}

        {isOffline ? (
          <Text
            accessibilityRole="alert"
            variant="bodySmall"
            style={[styles.offlineNote, { color: theme.colors.onSurfaceVariant }]}
          >
            {t('comparison.offlineUnavailable')}
          </Text>
        ) : null}

        {isConflict ? (
          <ConflictComparisonSection
            isOffline={isOffline}
            isLoading={comparisonQuery.isLoading}
            isError={comparisonQuery.isError}
            comparison={comparisonQuery.data ?? null}
            onRetryLoad={() => void comparisonQuery.refetch()}
          />
        ) : (
          <LocalChangeSection fields={getLocalChangeFields(operation)} />
        )}
      </ScrollView>

      <View style={styles.actionsRow}>
        {isConflict ? (
          <>
            <Button mode="outlined" disabled={isOffline || busy} onPress={() => void handleReload()}>
              {t('actions.reloadLatestVersion')}
            </Button>
            <Button
              mode="contained"
              disabled={isOffline || busy || !comparisonQuery.data?.serverTask}
              accessibilityState={{ disabled: isOffline || busy, busy }}
              onPress={() => setConfirmApply(true)}
            >
              {t('actions.applyMyChange')}
            </Button>
          </>
        ) : operation.status === 'retry_wait' ? (
          <Button mode="contained" disabled={isOffline || busy} accessibilityState={{ disabled: isOffline || busy, busy }} onPress={() => void handleRetry()}>
            {t('actions.retry')}
          </Button>
        ) : null}
        <Button
          mode="text"
          disabled={busy}
          accessibilityState={{ disabled: busy, busy }}
          onPress={() => setConfirmDiscard(true)}
        >
          {t(operation.lastSafeErrorCode === 'task_unavailable' ? 'actions.discardLocalChange' : 'actions.keepServerVersion')}
        </Button>
      </View>

      <Portal>
        <Dialog visible={confirmDiscard} onDismiss={() => setConfirmDiscard(false)}>
          <Dialog.Title>{t('confirm.discardTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('confirm.discardBody')}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDiscard(false)}>{t('confirm.cancel')}</Button>
            <Button onPress={() => void handleDiscard()}>{t('confirm.confirm')}</Button>
          </Dialog.Actions>
        </Dialog>
        <Dialog visible={confirmApply} onDismiss={() => setConfirmApply(false)}>
          <Dialog.Title>{t('confirm.applyTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('confirm.applyBody')}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmApply(false)}>{t('confirm.cancel')}</Button>
            <Button onPress={() => void handleApply()}>{t('confirm.confirm')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScreenContainer>
  );
}

function ConflictComparisonSection(props: {
  isOffline: boolean;
  isLoading: boolean;
  isError: boolean;
  comparison: { serverTask: unknown; fields: ComparisonField[] } | null;
  onRetryLoad: () => void;
}) {
  const { t } = useTranslation('syncIssues');
  if (props.isOffline) return null;
  if (props.isLoading) return <LoadingState label={t('comparison.loading')} />;
  if (props.isError) return <ErrorState description={t('comparison.error')} onRetry={props.onRetryLoad} />;
  if (!props.comparison || !props.comparison.serverTask) {
    return <Text variant="bodyMedium">{t('comparison.taskGone')}</Text>;
  }
  return <ComparisonTable fields={props.comparison.fields} />;
}

function ComparisonTable({ fields }: { fields: ComparisonField[] }) {
  const { t } = useTranslation('syncIssues');
  const theme = useAppTheme();
  const emptyLabel = t('comparison.emptyValue');
  return (
    <View style={styles.table} testID="sync-issue-comparison-table">
      <View style={styles.tableHeaderRow}>
        <Text variant="labelSmall" style={styles.fieldColumn}>
          {''}
        </Text>
        <Text variant="labelSmall" style={[styles.valueColumn, { color: theme.colors.onSurfaceVariant }]}>
          {t('comparison.localHeader')}
        </Text>
        <Text variant="labelSmall" style={[styles.valueColumn, { color: theme.colors.onSurfaceVariant }]}>
          {t('comparison.serverHeader')}
        </Text>
      </View>
      {fields.map((field) => (
        <View key={field.field} style={styles.tableRow} testID={`sync-issue-comparison-row-${field.field}`}>
          <Text variant="labelMedium" style={styles.fieldColumn}>
            {t(`comparison.field.${field.field}`)}
          </Text>
          <Text variant="bodySmall" style={styles.valueColumn}>
            {field.local ?? emptyLabel}
          </Text>
          <Text variant="bodySmall" style={styles.valueColumn}>
            {field.server ?? emptyLabel}
          </Text>
        </View>
      ))}
    </View>
  );
}

function LocalChangeSection({ fields }: { fields: ComparisonField[] }) {
  const { t } = useTranslation('syncIssues');
  const emptyLabel = t('comparison.emptyValue');
  return (
    <View style={styles.table}>
      {fields.map((field) => (
        <View key={field.field} style={styles.tableRow}>
          <Text variant="labelMedium" style={styles.fieldColumn}>
            {t(`comparison.field.${field.field}`)}
          </Text>
          <Text variant="bodySmall" style={styles.valueColumn}>
            {field.local ?? emptyLabel}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  offlineNote: {
    marginVertical: 8,
  },
  table: {
    marginTop: 12,
    gap: 6,
  },
  tableHeaderRow: {
    flexDirection: 'row',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  fieldColumn: {
    flex: 1,
  },
  valueColumn: {
    flex: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 12,
  },
});
