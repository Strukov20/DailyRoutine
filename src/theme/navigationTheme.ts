// As of Expo Router 6 (SDK 56+), navigation theming must come from
// `expo-router` itself, not `@react-navigation/native` directly — importing
// the latter fails Expo Router's bundler compatibility check.
import { DarkTheme as NavDarkTheme, DefaultTheme as NavDefaultTheme } from 'expo-router';
import type { Theme as NavigationTheme } from 'expo-router/react-navigation';

import { semanticColors } from './tokens';

/** Keeps React Navigation's chrome (headers, tab bar) visually in sync with Paper. */
export const appNavigationLightTheme: NavigationTheme = {
  ...NavDefaultTheme,
  colors: {
    ...NavDefaultTheme.colors,
    primary: semanticColors.light.primary,
    background: semanticColors.light.background,
    card: semanticColors.light.surface,
    text: semanticColors.light.onSurface,
    border: semanticColors.light.outline,
  },
};

export const appNavigationDarkTheme: NavigationTheme = {
  ...NavDarkTheme,
  colors: {
    ...NavDarkTheme.colors,
    primary: semanticColors.dark.primary,
    background: semanticColors.dark.background,
    card: semanticColors.dark.surface,
    text: semanticColors.dark.onSurface,
    border: semanticColors.dark.outline,
  },
};
