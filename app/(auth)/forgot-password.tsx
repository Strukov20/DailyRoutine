import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { z } from 'zod';

import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { authErrorMessageKey } from '@/domain/auth/errorMessages';
import { AuthServiceError, requestPasswordReset } from '@/lib/auth/authService';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('forgot-password');

const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'email_required').pipe(z.email('email_invalid')),
});
type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

const FIELD_ERROR_MESSAGE_KEYS: Record<string, string> = {
  email_required: 'signIn.errors.emailRequired',
  email_invalid: 'signIn.errors.emailInvalid',
};

export default function ForgotPasswordScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const theme = useAppTheme();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await requestPasswordReset(values.email);
      // Deliberately shown regardless of whether the account exists — a
      // different message for "no such account" would let an attacker
      // enumerate registered emails.
      setSentTo(values.email);
    } catch (error) {
      const code = error instanceof AuthServiceError ? error.code : 'unknown';
      logger.warn('password reset request failed', { code });
      setFormError(t(authErrorMessageKey(code)));
    }
  });

  if (sentTo) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.confirmationContent}>
          <EmptyState
            title={t('auth:forgotPassword.title')}
            description={t('auth:forgotPassword.linkSent', { email: sentTo })}
          />
          <Link href="/(auth)/sign-in" asChild>
            <Button mode="contained">{t('auth:forgotPassword.backToSignIn')}</Button>
          </Link>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.content}>
        <Text variant="headlineSmall" style={styles.title}>
          {t('auth:forgotPassword.title')}
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
        >
          {t('auth:forgotPassword.subtitle')}
        </Text>

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <View style={styles.field}>
              <TextInput
                mode="outlined"
                label={t('auth:forgotPassword.email')}
                autoCapitalize="none"
                keyboardType="email-address"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={Boolean(errors.email)}
                autoFocus
              />
              <HelperText type="error" visible={Boolean(errors.email)}>
                {errors.email
                  ? t(`auth:${FIELD_ERROR_MESSAGE_KEYS[errors.email.message ?? '']}`)
                  : ''}
              </HelperText>
            </View>
          )}
        />

        <HelperText type="error" visible={Boolean(formError)}>
          {formError}
        </HelperText>

        <Button mode="contained" onPress={onSubmit} loading={isSubmitting} style={styles.submit}>
          {t('auth:forgotPassword.submit')}
        </Button>

        <Link href="/(auth)/sign-in" style={styles.backLink}>
          <Text style={{ color: theme.colors.primary }}>
            {t('auth:forgotPassword.backToSignIn')}
          </Text>
        </Link>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  confirmationContent: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
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
  backLink: {
    alignSelf: 'center',
    marginTop: 24,
  },
});
