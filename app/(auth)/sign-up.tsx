import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { authErrorMessageKey } from '@/domain/auth/errorMessages';
import { signUpSchema, type SignUpInput } from '@/domain/auth/schemas';
import { AuthServiceError, signUpWithPassword } from '@/lib/auth/authService';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('sign-up');

const FIELD_ERROR_MESSAGE_KEYS: Record<string, string> = {
  name_required: 'signUp.errors.nameRequired',
  email_required: 'signIn.errors.emailRequired',
  email_invalid: 'signIn.errors.emailInvalid',
  password_too_short: 'signIn.errors.passwordTooShort',
};

export default function SignUpScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const theme = useAppTheme();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signUpWithPassword({
        email: values.email,
        password: values.password,
        displayName: values.name,
      });
      // Supabase's local dev config enables email confirmation (see
      // supabase/config.toml) — signUp does not create a usable session
      // until the link is confirmed, so there is nothing to auto-navigate
      // to yet. If confirmations are ever disabled, signUp already returns
      // a session and AuthProvider picks it up automatically.
      setConfirmationEmail(values.email);
    } catch (error) {
      const code = error instanceof AuthServiceError ? error.code : 'unknown';
      logger.warn('sign-up failed', { code });
      setFormError(t(authErrorMessageKey(code)));
    }
  });

  const errorMessage = (field: keyof SignUpInput): string | undefined => {
    const key = errors[field]?.message;
    return key ? t(`auth:${FIELD_ERROR_MESSAGE_KEYS[key] ?? key}`) : undefined;
  };

  if (confirmationEmail) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.confirmationContent}>
          <EmptyState
            title={t('auth:signUp.title')}
            description={t('auth:signUp.confirmationSent', { email: confirmationEmail })}
          />
          <Link href="/(auth)/sign-in" asChild>
            <Button mode="contained">{t('auth:signIn.submit')}</Button>
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
          {t('auth:signUp.title')}
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
        >
          {t('auth:signUp.subtitle')}
        </Text>

        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <View style={styles.field}>
              <TextInput
                mode="outlined"
                label={t('auth:signUp.name')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={Boolean(errors.name)}
              />
              <HelperText type="error" visible={Boolean(errors.name)}>
                {errorMessage('name')}
              </HelperText>
            </View>
          )}
        />

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <View style={styles.field}>
              <TextInput
                mode="outlined"
                label={t('auth:signUp.email')}
                autoCapitalize="none"
                keyboardType="email-address"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={Boolean(errors.email)}
              />
              <HelperText type="error" visible={Boolean(errors.email)}>
                {errorMessage('email')}
              </HelperText>
            </View>
          )}
        />

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <View style={styles.field}>
              <TextInput
                mode="outlined"
                label={t('auth:signUp.password')}
                secureTextEntry
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={Boolean(errors.password)}
              />
              <HelperText type="error" visible={Boolean(errors.password)}>
                {errorMessage('password')}
              </HelperText>
            </View>
          )}
        />

        <HelperText type="error" visible={Boolean(formError)}>
          {formError}
        </HelperText>

        <Button mode="contained" onPress={onSubmit} loading={isSubmitting} style={styles.submit}>
          {t('auth:signUp.submit')}
        </Button>

        <View style={styles.footer}>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>
            {t('auth:signUp.haveAccount')}
          </Text>
          <Link href="/(auth)/sign-in">
            <Text style={{ color: theme.colors.primary }}> {t('auth:signUp.signIn')}</Text>
          </Link>
        </View>
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
});
