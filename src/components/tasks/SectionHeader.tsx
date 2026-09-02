import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useAppTheme } from '@/theme';

interface SectionHeaderProps {
  title: string;
  count?: number;
}

export function SectionHeader({ title, count }: SectionHeaderProps) {
  const theme = useAppTheme();

  return (
    <View style={styles.row}>
      <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
        {title}
      </Text>
      {typeof count === 'number' ? (
        <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          {count}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
});
