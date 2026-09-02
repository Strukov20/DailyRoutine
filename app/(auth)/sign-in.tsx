import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Stack } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { signInSchema, type SignInInput } from '@/domain/auth/schemas';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('sign-in');

const ERROR_MESSAGE_KEYS: Record<string, string> = {
  email_required: 'signIn.errors.emailRequired',
  email_invalid: 'signIn.errors.emailInvalid',
  password_too_short: 'signIn.errors.passwordTooShort',
};

export default function SignInScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const theme = useAppTheme();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    // Real sign-in (Supabase Auth) is a later phase — see docs/ROADMAP.md.
    // This proves the validated-form path end to end without persisting
    // anything or claiming a session was created.
    logger.info('sign-in submitted (not yet wired to Supabase)', { email: values.email });
  });

  const errorMessage = (field: keyof SignInInput): string | undefined => {
    const key = errors[field]?.message;
    return key ? t(`auth:${ERROR_MESSAGE_KEYS[key] ?? key}`) : undefined;
  };

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.content}>
        <Text variant="headlineSmall" style={styles.title}>
          {t('auth:signIn.title')}
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
        >
          {t('auth:signIn.subtitle')}
        </Text>

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <View style={styles.field}>
              <TextInput
                mode="outlined"
                label={t('auth:signIn.email')}
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
                label={t('auth:signIn.password')}
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

        <Button mode="contained" onPress={onSubmit} loading={isSubmitting} style={styles.submit}>
          {t('auth:signIn.submit')}
        </Button>

        <Text style={[styles.notice, { color: theme.colors.onSurfaceVariant }]}>
          {t('auth:notImplemented')}
        </Text>

        <View style={styles.footer}>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('auth:signIn.noAccount')}</Text>
          <Link href="/(auth)/sign-up">
            <Text style={{ color: theme.colors.primary }}> {t('auth:signIn.createAccount')}</Text>
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
  notice: {
    marginTop: 16,
    fontSize: 12,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
});
