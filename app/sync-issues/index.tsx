import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, Text as RNText } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { useShallow } from 'zustand/react/shallow';

import { SyncIssueCard } from '@/components/sync-issues/SyncIssueCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { selectSyncIssues, useOfflineQueueStore } from '@/lib/offline/offlineQueueStore';
import { discardSyncIssue, retrySyncIssue } from '@/lib/offline/syncIssueResolution';
import { retryOfflineQueue } from '@/lib/offline/useOfflineQueueSync';
import { useIsOffline } from '@/lib/query/useIsOffline';

/**
 * The Sync Issues list (Phase 9 completion pass, Section 2) — every
 * offline-queued personal-task operation that has failed at least once
 * (a still-auto-retrying transient failure, a stale-write conflict, or a
 * permanent failure), oldest first. Deliberately separate from the
 * Conflict Center (`/conflicts`), which is schedule conflicts only —
 * these are synchronization conflicts, a different domain entirely (see
 * docs/DECISIONS.md, "Phase 9").
 */
export default function SyncIssuesScreen() {
  const { t, i18n } = useTranslation('syncIssues');
  const isOffline = useIsOffline();
  const profileId = useOfflineQueueStore((state) => state.profileId);
  const issues = useOfflineQueueStore(useShallow(selectSyncIssues));
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function handleRetry(operationId: string) {
    setBusyOperationId(operationId);
    try {
      await retrySyncIssue(operationId);
    } finally {
      setBusyOperationId(null);
    }
  }

  async function handleConfirmDiscard() {
    if (!discardTarget) return;
    setBusyOperationId(discardTarget);
    try {
      await discardSyncIssue(discardTarget);
    } finally {
      setBusyOperationId(null);
      setDiscardTarget(null);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await retryOfflineQueue();
    } finally {
      setRefreshing(false);
    }
  }

  // profileId is set synchronously by useOfflineQueueSync's hydrate once
  // auth is ready — null only for the brief window before that resolves.
  if (profileId === null) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {isOffline ? (
        <RNText accessibilityRole="alert" style={styles.offlineNote} testID="sync-issues-offline-note">
          {t('offlineNote')}
        </RNText>
      ) : null}

      {issues.length === 0 ? (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <ScrollView
          testID="sync-issues-scroll"
          refreshControl={
            <RefreshControl
              testID="sync-issues-refresh-control"
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
            />
          }
        >
          {issues.map((operation) => (
            <SyncIssueCard
              key={operation.operationId}
              operation={operation}
              locale={i18n.language}
              onRetry={(id) => void handleRetry(id)}
              onDiscard={(id) => setDiscardTarget(id)}
              isBusy={busyOperationId === operation.operationId}
            />
          ))}
        </ScrollView>
      )}

      <Portal>
        <Dialog visible={discardTarget !== null} onDismiss={() => setDiscardTarget(null)}>
          <Dialog.Title>{t('confirm.discardTitle')}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{t('confirm.discardBody')}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDiscardTarget(null)}>{t('confirm.cancel')}</Button>
            <Button onPress={() => void handleConfirmDiscard()}>{t('confirm.confirm')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  offlineNote: {
    marginBottom: 8,
    fontSize: 13,
  },
});
