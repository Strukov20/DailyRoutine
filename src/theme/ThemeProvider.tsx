import { MaterialCommunityIcons } from '@expo/vector-icons';
// See src/theme/navigationTheme.ts for why this comes from expo-router,
// not @react-navigation/native.
import { ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { createContext, use, useMemo, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { useUIStore } from '@/store/uiStore';

import { appNavigationDarkTheme, appNavigationLightTheme } from './navigationTheme';
import { appDarkTheme, appLightTheme } from './paperTheme';
import { radii, semanticColors, spacing, typography } from './tokens';

type ThemeColors = { [K in keyof typeof semanticColors.light]: string };

interface AppTheme {
  dark: boolean;
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
}

const AppThemeContext = createContext<AppTheme | null>(null);

export function useAppTheme(): AppTheme {
  const theme = use(AppThemeContext);
  if (!theme) {
    throw new Error('useAppTheme must be used within <AppThemeProvider>');
  }
  return theme;
}

export function AppThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const override = useUIStore((state) => state.colorSchemeOverride);
  const resolvedScheme = override === 'system' ? (systemScheme ?? 'light') : override;
  const isDark = resolvedScheme === 'dark';

  const appTheme = useMemo<AppTheme>(
    () => ({
      dark: isDark,
      colors: isDark ? semanticColors.dark : semanticColors.light,
      spacing,
      radii,
      typography,
    }),
    [isDark],
  );

  const paperTheme = isDark ? appDarkTheme : appLightTheme;
  const navigationTheme = isDark ? appNavigationDarkTheme : appNavigationLightTheme;

  return (
    <AppThemeContext value={appTheme}>
      <PaperProvider theme={paperTheme} settings={paperIconSettings}>
        <NavigationThemeProvider value={navigationTheme}>{children}</NavigationThemeProvider>
      </PaperProvider>
    </AppThemeContext>
  );
}

/**
 * Points Paper at @expo/vector-icons instead of the (deprecated, unmaintained)
 * react-native-vector-icons package it falls back to by default.
 */
const paperIconSettings = {
  icon: (props: { name: string; color?: string; size: number }) => (
    <MaterialCommunityIcons
      name={props.name as never}
      color={props.color ?? semanticColors.light.onSurface}
      size={props.size}
    />
  ),
};
