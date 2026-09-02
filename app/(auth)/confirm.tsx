import { useLocalSearchParams, Link, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button } from 'react-native-paper';

import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { exchangeCodeForSession } from '@/lib/auth/authService';
import { createLogger } from '@/lib/logger/logger';

const logger = createLogger('confirm-email');

/**
 * Lands here from the email-confirmation link's redirect
 * (familyflow://confirm?code=...) — see src/lib/supabase/authRedirect.ts
 * and supabase/config.toml's additional_redirect_urls. On success,
 * AuthProvider's auth-state listener picks up the new session and the root
 * layout's Stack.Protected guard (app/_layout.tsx) automatically swaps in
 * the signed-in app; no manual navigation is needed here.
 */
export default function ConfirmEmailScreen() {
  const { t } = useTranslation('auth');
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [status, setStatus] = useState<'confirming' | 'success' | 'error'>(() =>
    code ? 'confirming' : 'error',
  );

  useEffect(() => {
    if (!code) {
      return;
    }

    let cancelled = false;
    void exchangeCodeForSession(code)
      .then(() => {
        if (!cancelled) setStatus('success');
      })
      .catch((error: unknown) => {
        logger.warn('email confirmation failed', {
          message: error instanceof Error ? error.message : 'unknown',
        });
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {status === 'confirming' && <LoadingState label={t('confirmEmail.confirming')} />}
        {status === 'success' && <LoadingState label={t('confirmEmail.success')} />}
        {status === 'error' && (
          <>
            <ErrorState
              title={t('confirmEmail.invalidLink.title')}
              description={t('confirmEmail.invalidLink.description')}
            />
            <Link href="/(auth)/sign-in" asChild>
              <Button mode="contained" style={{ alignSelf: 'center', marginTop: 16 }}>
                {t('confirmEmail.invalidLink.action')}
              </Button>
            </Link>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}
