import { Stack, router, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { initI18n } from '@/i18n';
import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider';
import { useNotificationResponseRouter } from '@/lib/notifications/notificationResponseRouter';
import { QueryProvider } from '@/lib/query/QueryProvider';
import { useUIStore } from '@/store/uiStore';
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
            <AuthProvider>
              <ErrorBoundary>
                <RootNavigator />
              </ErrorBoundary>
            </AuthProvider>
          </QueryProvider>
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const theme = useAppTheme();
  const { status } = useAuth();
  const pendingInviteToken = useUIStore((state) => state.pendingInviteToken);
  const setPendingInviteToken = useUIStore((state) => state.setPendingInviteToken);
  const pendingNotificationRoute = useUIStore((state) => state.pendingNotificationRoute);
  const setPendingNotificationRoute = useUIStore((state) => state.setPendingNotificationRoute);

  // Active for the app's whole lifetime (not just while signed in), so a
  // cold-start/background tap while signed out still resolves to a
  // pending route via the effect below, rather than being missed because
  // no listener was mounted yet.
  useNotificationResponseRouter(status === 'signed-in');

  // A signed-out visitor who opened an invitation deep link
  // (app/invite/[token].tsx) was sent to sign in/up with no way to carry
  // the token through that flow's own navigation. Once they're signed in,
  // send them straight back to the invite screen instead of the default
  // (app) tab.
  useEffect(() => {
    if (status === 'signed-in' && pendingInviteToken) {
      setPendingInviteToken(null);
      router.replace(`/invite/${pendingInviteToken}`);
    }
  }, [status, pendingInviteToken, setPendingInviteToken]);

  // Same pattern, for a push notification tapped while signed out (see
  // src/lib/notifications/notificationResponseRouter.ts).
  useEffect(() => {
    if (status === 'signed-in' && pendingNotificationRoute) {
      setPendingNotificationRoute(null);
      // Resolved at runtime from a parsed push payload — see
      // notificationResponseRouter.ts's own cast for why this can't be a
      // statically-checked route literal.
      router.push(pendingNotificationRoute as Href);
    }
  }, [status, pendingNotificationRoute, setPendingNotificationRoute]);

  if (status === 'loading') {
    // Nothing renders behind this while the session restores — prevents a
    // flash of signed-out (or signed-in) content on cold start. See
    // docs/DECISIONS.md, "Authentication".
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={status === 'signed-out'}>
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signed-in'}>
          <Stack.Screen name="(app)" />
          <Stack.Screen name="task/new" options={{ presentation: 'modal', headerShown: true }} />
          <Stack.Screen
            name="task/[id]/edit"
            options={{ presentation: 'modal', headerShown: true }}
          />
          <Stack.Screen name="tomorrow" options={{ headerShown: true }} />
          <Stack.Screen
            name="family/create"
            options={{ presentation: 'modal', headerShown: true }}
          />
          <Stack.Screen
            name="family/invite"
            options={{ presentation: 'modal', headerShown: true }}
          />
          <Stack.Screen
            name="family/add-child"
            options={{ presentation: 'modal', headerShown: true }}
          />
          <Stack.Screen name="family/member/[id]" options={{ headerShown: true }} />
          <Stack.Screen name="notification-settings" options={{ headerShown: true }} />
          <Stack.Screen name="event/new" options={{ presentation: 'modal', headerShown: true }} />
          <Stack.Screen name="event/[id]" options={{ headerShown: true }} />
          <Stack.Screen name="event/[id]/edit" options={{ presentation: 'modal', headerShown: true }} />
        </Stack.Protected>
        <Stack.Screen name="index" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="auth-callback" />
        <Stack.Screen name="invite/[token]" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
