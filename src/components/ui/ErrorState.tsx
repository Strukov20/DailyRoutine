import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useAppTheme } from '@/theme';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

/** Reusable error state for failed queries/screens, with an optional retry action. */
export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  const theme = useAppTheme();
  const { t } = useTranslation('common');

  return (
    <View style={[styles.container, { paddingVertical: theme.spacing.xxl }]}>
      <Text variant="titleMedium" style={{ color: theme.colors.danger, textAlign: 'center' }}>
        {title ?? t('state.somethingWentWrong')}
      </Text>
      {description ? (
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 4 }}
        >
          {description}
        </Text>
      ) : null}
      {onRetry ? (
        <Button mode="contained" onPress={onRetry} style={styles.action}>
          {t('actions.retry')}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: {
    marginTop: 16,
  },
});
