import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import {
  selectHasFailedOperations,
  selectPendingOperationCount,
  useOfflineQueueStore,
} from '@/lib/offline/offlineQueueStore';
import { retryOfflineQueue } from '@/lib/offline/useOfflineQueueSync';
import { useIsOffline } from '@/lib/query/useIsOffline';
import { useUIStore, type UIState } from '@/store/uiStore';
import { useAppTheme } from '@/theme';

export type SyncDisplayState = 'synced' | 'syncing' | 'pending' | 'sync-issue' | 'offline';

/**
 * Phase 9, Section 16 — one shared, small, non-color-only status signal
 * (icon + text) covering the sync-status states the brief calls for:
 * Synced / Offline / Pending changes: N / Syncing / Sync issue. A failed
 * offline operation always wins the display (it's the one state that
 * needs the viewer's attention); "offline" defers to the existing
 * OfflineBanner (mounted on the same screens) rather than repeating the
 * same signal in two places.
 */
export function resolveSyncDisplayState(params: {
  isOffline: boolean;
  hasFailedOperations: boolean;
  pendingCount: number;
  isReplaying: boolean;
  realtimeStatus: UIState['realtimeStatus'];
}): SyncDisplayState {
  const { isOffline, hasFailedOperations, pendingCount, isReplaying, realtimeStatus } = params;
  if (hasFailedOperations) return 'sync-issue';
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
  const hasFailedOperations = useOfflineQueueStore(selectHasFailedOperations);
  const isReplaying = useOfflineQueueStore((state) => state.isReplaying);

  const displayState = resolveSyncDisplayState({
    isOffline,
    hasFailedOperations,
    pendingCount,
    isReplaying,
    realtimeStatus,
  });

  // OfflineBanner (mounted alongside this on the same screens) already
  // announces plain connectivity loss — nothing to add here.
  if (displayState === 'offline') return null;

  const { icon, color, label } = describe(displayState, pendingCount, theme, t);

  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <Icon source={icon} size={14} color={color} />
      <Text variant="labelSmall" style={{ color }}>
        {label}
      </Text>
      {displayState === 'sync-issue' && (
        <Pressable onPress={retryOfflineQueue} hitSlop={8} accessibilityRole="button">
          <Text variant="labelSmall" style={[styles.retry, { color: theme.colors.primary }]}>
            {t('actions.retry')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function describe(
  state: SyncDisplayState,
  pendingCount: number,
  theme: ReturnType<typeof useAppTheme>,
  t: ReturnType<typeof useTranslation<'common'>>['t'],
): { icon: string; color: string; label: string } {
  switch (state) {
    case 'sync-issue':
      return { icon: 'cloud-alert-outline', color: theme.colors.danger, label: t('sync.syncIssue') };
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
  retry: {
    marginLeft: 4,
    textDecorationLine: 'underline',
  },
});
