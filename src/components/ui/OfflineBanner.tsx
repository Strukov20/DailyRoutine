import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { useIsOffline } from '@/lib/query/useIsOffline';
import { useAppTheme } from '@/theme';

/** Renders nothing while online — mount unconditionally at the top of a data screen. */
export function OfflineBanner() {
  const { t } = useTranslation('common');
  const theme = useAppTheme();
  const isOffline = useIsOffline();

  if (!isOffline) return null;

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.surfaceVariant }]}
      accessibilityRole="alert"
    >
      <Icon source="wifi-off" size={16} color={theme.colors.onSurfaceVariant} />
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {t('state.offline')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
});
