import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useShallow } from 'zustand/react/shallow';

import {
  selectPendingOperationCount,
  selectSyncIssueCount,
  selectSyncIssues,
  useOfflineQueueStore,
} from '@/lib/offline/offlineQueueStore';
import { useIsOffline } from '@/lib/query/useIsOffline';
import { useUIStore, type UIState } from '@/store/uiStore';
import { useAppTheme } from '@/theme';

export type SyncDisplayState = 'synced' | 'syncing' | 'pending' | 'sync-issues' | 'offline';

/**
 * Phase 9, Section 7 — one shared, small, non-color-only status signal
 * (icon + text) covering: Synced / Offline / Pending changes: N /
 * Syncing / Sync issues: N. A sync issue (a conflict needing review, or a
 * failure only Discard can resolve) always wins the display — it's the
 * one state that needs the viewer's attention; "offline" defers to the
 * existing OfflineBanner (mounted on the same screens) rather than
 * repeating the same signal in two places.
 */
export function resolveSyncDisplayState(params: {
  isOffline: boolean;
  hasSyncIssues: boolean;
  pendingCount: number;
  isReplaying: boolean;
  realtimeStatus: UIState['realtimeStatus'];
}): SyncDisplayState {
  const { isOffline, hasSyncIssues, pendingCount, isReplaying, realtimeStatus } = params;
  if (hasSyncIssues) return 'sync-issues';
  if (isOffline) return pendingCount > 0 ? 'pending' : 'offline';
  if (isReplaying) return 'syncing';
  if (pendingCount > 0) return 'pending';
  if (realtimeStatus === 'connecting' || realtimeStatus === 'reconnecting') return 'syncing';
  return 'synced';
}

export function SyncStatusIndicator() {
  const { t } = useTranslation('common');
  const theme = useAppTheme();
  const isOffline = useIsOffline();
  const realtimeStatus = useUIStore((state) => state.realtimeStatus);
  const pendingCount = useOfflineQueueStore(selectPendingOperationCount);
  const syncIssueCount = useOfflineQueueStore(selectSyncIssueCount);
  // Only read to decide the accessible label's wording (Section 7: "transient
  // retryable items and review-required conflicts have distinguishable
  // accessible text") — never to drive layout, so a rapid run of queue
  // updates only ever re-renders this component, never triggers navigation.
  const syncIssues = useOfflineQueueStore(useShallow(selectSyncIssues));
  const isReplaying = useOfflineQueueStore((state) => state.isReplaying);

  const displayState = resolveSyncDisplayState({
    isOffline,
    hasSyncIssues: syncIssueCount > 0,
    pendingCount,
    isReplaying,
    realtimeStatus,
  });

  // OfflineBanner (mounted alongside this on the same screens) already
  // announces plain connectivity loss — nothing to add here.
  if (displayState === 'offline') return null;

  const { icon, color, label } = describe(displayState, pendingCount, syncIssueCount, syncIssues, theme, t);

  const row = (
    <View style={styles.row} accessible accessibilityLabel={label} accessibilityRole={displayState === 'sync-issues' ? 'button' : undefined}>
      <Icon source={icon} size={14} color={color} />
      <Text variant="labelSmall" style={{ color }}>
        {label}
      </Text>
    </View>
  );

  if (displayState === 'sync-issues') {
    return (
      <Pressable
        onPress={() => router.push('/sync-issues')}
        hitSlop={8}
        style={styles.touchTarget}
        testID="sync-issues-indicator"
      >
        {row}
      </Pressable>
    );
  }

  return row;
}

function describe(
  state: SyncDisplayState,
  pendingCount: number,
  syncIssueCount: number,
  syncIssues: ReturnType<typeof selectSyncIssues>,
  theme: ReturnType<typeof useAppTheme>,
  t: ReturnType<typeof useTranslation<'common'>>['t'],
): { icon: string; color: string; label: string } {
  switch (state) {
    case 'sync-issues': {
      const allNeedReview = syncIssues.every((op) => op.status === 'conflict');
      const label = allNeedReview
        ? t('sync.needsReview', { count: syncIssueCount })
        : t('sync.syncIssues', { count: syncIssueCount });
      return { icon: 'cloud-alert-outline', color: theme.colors.danger, label };
    }
    case 'pending':
      return {
        icon: 'cloud-upload-outline',
        color: theme.colors.warning,
        label: t('sync.pendingChanges', { count: pendingCount }),
      };
    case 'syncing':
      return { icon: 'cloud-sync-outline', color: theme.colors.onSurfaceVariant, label: t('sync.syncing') };
    case 'synced':
    case 'offline':
      return { icon: 'cloud-check-outline', color: theme.colors.onSurfaceVariant, label: t('sync.synced') };
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // Section 10 — minimum 44x44 touch target for the tappable sync-issues state.
  touchTarget: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
});
