import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Stack } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { signUpSchema, type SignUpInput } from '@/domain/auth/schemas';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('sign-up');

const ERROR_MESSAGE_KEYS: Record<string, string> = {
  name_required: 'signUp.errors.nameRequired',
  email_required: 'signIn.errors.emailRequired',
  email_invalid: 'signIn.errors.emailInvalid',
  password_too_short: 'signIn.errors.passwordTooShort',
};

export default function SignUpScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const theme = useAppTheme();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    logger.info('sign-up submitted (not yet wired to Supabase)', { email: values.email });
  });

  const errorMessage = (field: keyof SignUpInput): string | undefined => {
    const key = errors[field]?.message;
    return key ? t(`auth:${ERROR_MESSAGE_KEYS[key] ?? key}`) : undefined;
  };

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

        <Button mode="contained" onPress={onSubmit} loading={isSubmitting} style={styles.submit}>
          {t('auth:signUp.submit')}
        </Button>

        <Text style={[styles.notice, { color: theme.colors.onSurfaceVariant }]}>
          {t('auth:notImplemented')}
        </Text>

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
