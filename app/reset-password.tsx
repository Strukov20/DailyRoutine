import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { z } from 'zod';

import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { authErrorMessageKey } from '@/domain/auth/errorMessages';
import { AuthServiceError, exchangeCodeForSession, updatePassword } from '@/lib/auth/authService';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('reset-password');

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'password_too_short'),
});
type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * A top-level route (not under app/(auth)/) — deliberately outside both
 * Stack.Protected guards in app/_layout.tsx. Exchanging the recovery code
 * below authenticates the user with a real session, which would otherwise
 * cause the (auth) group's guard to immediately hide this screen before
 * they can actually set a new password. See docs/DECISIONS.md,
 * "Authentication: password reset routing".
 */
export default function ResetPasswordScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const theme = useAppTheme();
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [exchangeState, setExchangeState] = useState<'pending' | 'ready' | 'error'>(() =>
    code ? 'pending' : 'error',
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '' },
  });

  useEffect(() => {
    if (!code) {
      return;
    }
    void exchangeCodeForSession(code)
      .then(() => setExchangeState('ready'))
      .catch((error: unknown) => {
        logger.warn('recovery code exchange failed', {
          message: error instanceof Error ? error.message : 'unknown',
        });
        setExchangeState('error');
      });
  }, [code]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await updatePassword(values.password);
      setSucceeded(true);
    } catch (error) {
      const errorCode = error instanceof AuthServiceError ? error.code : 'unknown';
      logger.warn('password update failed', { code: errorCode });
      setFormError(t(authErrorMessageKey(errorCode)));
    }
  });

  if (exchangeState === 'pending') {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <LoadingState />
        </View>
      </ScreenContainer>
    );
  }

  if (exchangeState === 'error') {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ErrorState
            title={t('auth:resetPassword.invalidLink.title')}
            description={t('auth:resetPassword.invalidLink.description')}
          />
        </View>
      </ScreenContainer>
    );
  }

  if (succeeded) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.content}>
          <Text variant="headlineSmall" style={styles.title}>
            {t('auth:resetPassword.success')}
          </Text>
          <Button mode="contained" onPress={() => router.replace('/')} style={styles.submit}>
            {t('auth:resetPassword.continue')}
          </Button>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.content}>
        <Text variant="headlineSmall" style={styles.title}>
          {t('auth:resetPassword.title')}
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
        >
          {t('auth:resetPassword.subtitle')}
        </Text>

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <View style={styles.field}>
              <TextInput
                mode="outlined"
                label={t('auth:resetPassword.password')}
                secureTextEntry
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={Boolean(errors.password)}
                autoFocus
              />
              <HelperText type="error" visible={Boolean(errors.password)}>
                {errors.password ? t('auth:signIn.errors.passwordTooShort') : ''}
              </HelperText>
            </View>
          )}
        />

        <HelperText type="error" visible={Boolean(formError)}>
          {formError}
        </HelperText>

        <Button mode="contained" onPress={onSubmit} loading={isSubmitting} style={styles.submit}>
          {t('auth:resetPassword.submit')}
        </Button>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    marginBottom: 4,
  },
  subtitle: {
    marginBottom: 24,
  },
  field: {
    marginBottom: 4,
  },
  submit: {
    marginTop: 8,
  },
});
