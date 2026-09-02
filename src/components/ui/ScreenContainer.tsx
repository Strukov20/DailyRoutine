import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme';

interface ScreenContainerProps extends PropsWithChildren {
  /** Disable horizontal/vertical padding, e.g. for screens with their own scroll padding. */
  noPadding?: boolean;
}

/** Common screen wrapper: safe-area aware, themed background, consistent padding. */
export function ScreenContainer({ children, noPadding = false }: ScreenContainerProps) {
  const theme = useAppTheme();

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
      edges={['top', 'left', 'right']}
    >
      <View
        style={[
          styles.flex,
          !noPadding && {
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.md,
          },
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
