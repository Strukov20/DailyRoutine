import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useAppTheme } from '@/theme';

/** Icon + text, never color alone — same accessibility rule as PriorityIndicator. */
export function OverdueIndicator() {
  const { t } = useTranslation('tasks');
  const theme = useAppTheme();
  const label = t('overdue.label');

  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <Icon source="clock-alert-outline" size={14} color={theme.colors.danger} />
      <Text variant="labelSmall" style={{ color: theme.colors.danger }}>
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
