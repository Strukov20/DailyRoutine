import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { useAppTheme } from '@/theme';

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Reusable empty state for lists/screens with no data yet. */
export function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  const theme = useAppTheme();

  return (
    <View style={[styles.container, { paddingVertical: theme.spacing.xxl }]}>
      <Text variant="titleMedium" style={styles.title}>
        {title}
      </Text>
      {description ? (
        <Text
          variant="bodyMedium"
          style={[styles.description, { color: theme.colors.onSurfaceVariant }]}
        >
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button mode="contained-tonal" onPress={onAction} style={styles.action}>
          {actionLabel}
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
  title: {
    textAlign: 'center',
    marginBottom: 4,
  },
  description: {
    textAlign: 'center',
    maxWidth: 280,
  },
  action: {
    marginTop: 16,
  },
});
