import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useAppTheme } from '@/theme';

interface LoadingStateProps {
  label?: string;
}

/** Reusable full-area loading indicator with a themed, translated label. */
export function LoadingState({ label }: LoadingStateProps) {
  const theme = useAppTheme();
  const { t } = useTranslation('common');

  return (
    <View style={[styles.container, { paddingVertical: theme.spacing.xxl }]}>
      <ActivityIndicator animating size="small" />
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
        {label ?? t('state.loading')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
