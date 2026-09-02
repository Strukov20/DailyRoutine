import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';

import { radii, semanticColors, spacing } from './tokens';

export const appLightTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: radii.md / 4, // Paper's `roundness` is a multiplier, not px
  colors: {
    ...MD3LightTheme.colors,
    primary: semanticColors.light.primary,
    onPrimary: semanticColors.light.onPrimary,
    primaryContainer: semanticColors.light.primaryContainer,
    background: semanticColors.light.background,
    surface: semanticColors.light.surface,
    surfaceVariant: semanticColors.light.surfaceVariant,
    onSurface: semanticColors.light.onSurface,
    onSurfaceVariant: semanticColors.light.onSurfaceVariant,
    outline: semanticColors.light.outline,
    error: semanticColors.light.danger,
  },
};

export const appDarkTheme: MD3Theme = {
  ...MD3DarkTheme,
  roundness: radii.md / 4,
  colors: {
    ...MD3DarkTheme.colors,
    primary: semanticColors.dark.primary,
    onPrimary: semanticColors.dark.onPrimary,
    primaryContainer: semanticColors.dark.primaryContainer,
    background: semanticColors.dark.background,
    surface: semanticColors.dark.surface,
    surfaceVariant: semanticColors.dark.surfaceVariant,
    onSurface: semanticColors.dark.onSurface,
    onSurfaceVariant: semanticColors.dark.onSurfaceVariant,
    outline: semanticColors.dark.outline,
    error: semanticColors.dark.danger,
  },
};

export { spacing };
