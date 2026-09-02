import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { initI18n } from '@/i18n';
import { QueryProvider } from '@/lib/query/QueryProvider';
import { AppThemeProvider, useAppTheme } from '@/theme';

// Synchronous — resources are bundled, not fetched — so translations are
// ready before the first screen renders.
initI18n();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppThemeProvider>
          <QueryProvider>
            <ErrorBoundary>
              <RootNavigator />
            </ErrorBoundary>
          </QueryProvider>
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const theme = useAppTheme();

  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="task/new" options={{ presentation: 'modal', headerShown: true }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
