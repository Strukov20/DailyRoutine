import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';

import type { FamilyMember } from '@/domain/family/types';
import type { FamilyConflict } from '@/domain/conflicts/types';
import { useAppTheme } from '@/theme';

interface ConflictRowProps {
  conflict: FamilyConflict;
  /** Used only to resolve memberId -> a display name — never to look up anything private. */
  members: FamilyMember[];
}

/**
 * Phase 9, Section 15 — one Conflict Center row. Every string rendered here
 * comes from `safeMessageCode`/`safeMessageParams` (server-redacted) plus
 * this family's own member roster (a name, never a private title) — see
 * FamilyConflict's own doc comment for why that's safe. Icon + text, never
 * color alone (same accessibility rule as PriorityIndicator/
 * OverdueIndicator).
 */
export function ConflictRow({ conflict, members }: ConflictRowProps) {
  const { t } = useTranslation('conflicts');
  const theme = useAppTheme();

  const memberName =
    (conflict.memberId && members.find((member) => member.id === conflict.memberId)?.displayName) ||
    t('unknownMember');

  // `safe_message_code` is literally `'conflicts.' + type` (see the RPC's
  // own comment in supabase/migrations/20260909120000_realtime_offline_conflicts.sql)
  // — this file's own i18n keys are flat (not nested under a `conflicts`
  // object) since useTranslation('conflicts') already scopes the namespace,
  // so only the suffix after the DB's own "conflicts." prefix is looked up.
  const messageKey = conflict.safeMessageCode.replace(/^conflicts\./, '');
  const message = t(messageKey, { name: memberName, time: conflict.safeMessageParams.time ?? '' });

  const severityColor = conflict.severity === 'critical' ? theme.colors.danger : theme.colors.warning;
  const severityIcon = conflict.severity === 'critical' ? 'alert-circle' : 'alert-circle-outline';
  const severityLabel = t(`severity.${conflict.severity}`);

  function handleReview() {
    // Private Busy conflicts belonging to another adult must never
    // navigate to their private event/task (Section 15) — the RPC already
    // enforces this by nulling primaryEntityId whenever navigating isn't
    // safe, so a null id here always falls through to the generic Family
    // Today surface rather than attempting a private-item route.
    if (conflict.primaryEntityType === 'event' && conflict.primaryEntityId) {
      router.push(`/event/${conflict.primaryEntityId}` as Href);
      return;
    }
    if (conflict.primaryEntityType === 'task' && conflict.primaryEntityId) {
      router.push({ pathname: '/task/[id]/edit', params: { id: conflict.primaryEntityId } });
      return;
    }
    // 'occurrence' (no dedicated single-occurrence edit route) and
    // 'responsibility' (managed inline in the Day Calendar, not its own
    // screen) both resolve to the same real, always-safe surface named in
    // Section 15: Family Today.
    router.push('/calendar' as Href);
  }

  return (
    <View
      style={[styles.row, { borderColor: theme.colors.outline }]}
      accessible
      accessibilityLabel={`${severityLabel}. ${message}`}
    >
      <Icon source={severityIcon} size={20} color={severityColor} />
      <View style={styles.textColumn}>
        <Text variant="labelSmall" style={{ color: severityColor }}>
          {severityLabel}
        </Text>
        <Text variant="bodyMedium">{message}</Text>
      </View>
      <Button mode="text" compact onPress={handleReview}>
        {t('actions.review')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    marginBottom: 8,
  },
  textColumn: {
    flex: 1,
    gap: 2,
  },
});
