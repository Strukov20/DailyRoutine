import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import type { TaskPriority } from '@/domain/tasks/priority';
import { priorityColors, useAppTheme } from '@/theme';

const PRIORITY_ICON: Record<TaskPriority, string> = {
  normal: 'circle-outline',
  important: 'alert-circle-outline',
  critical: 'alert-circle',
};

interface PriorityIndicatorProps {
  priority: TaskPriority;
  /** Compact renders only the icon (with an accessibility label); otherwise icon + text label. */
  compact?: boolean;
}

/**
 * Never color-only (see docs/ACCESSIBILITY note in docs/TEST_STRATEGY.md /
 * this phase's brief): a distinct icon per priority carries the meaning,
 * color is a reinforcing accent on top of it.
 */
export function PriorityIndicator({ priority, compact = false }: PriorityIndicatorProps) {
  const { t } = useTranslation('common');
  const theme = useAppTheme();
  const label = t(`priority.${priority}`);
  const color = priorityColors[priority];

  if (compact) {
    return (
      <View accessible accessibilityLabel={label}>
        <Icon source={PRIORITY_ICON[priority]} size={16} color={color} />
      </View>
    );
  }

  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <Icon source={PRIORITY_ICON[priority]} size={16} color={color} />
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
