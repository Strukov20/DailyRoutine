import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Divider, HelperText, Text, TextInput } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { signInSchema, type SignInInput } from '@/domain/auth/schemas';
import { authErrorMessageKey } from '@/domain/auth/errorMessages';
import { AuthServiceError, signInWithPassword } from '@/lib/auth/authService';
import {
  isAppleAuthEnabled,
  isGoogleAuthEnabled,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/auth/oauth';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('sign-in');

const FIELD_ERROR_MESSAGE_KEYS: Record<string, string> = {
  email_required: 'signIn.errors.emailRequired',
  email_invalid: 'signIn.errors.emailInvalid',
  password_too_short: 'signIn.errors.passwordTooShort',
};

export default function SignInScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const theme = useAppTheme();
  const [formError, setFormError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'apple' | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signInWithPassword(values);
      // No navigation call needed: AuthProvider's onAuthStateChange flips
      // status to 'signed-in', and the root Stack.Protected guard (see
      // app/_layout.tsx) automatically swaps in the (app) tabs.
    } catch (error) {
      const code = error instanceof AuthServiceError ? error.code : 'unknown';
      logger.warn('sign-in failed', { code });
      setFormError(t(authErrorMessageKey(code)));
    }
  });

  const onOAuthPress = async (provider: 'google' | 'apple') => {
    setFormError(null);
    setOauthLoading(provider);
    try {
      await (provider === 'google' ? signInWithGoogle() : signInWithApple());
    } catch (error) {
      const code = error instanceof AuthServiceError ? error.code : 'unknown';
      logger.warn(`${provider} sign-in failed`, { code });
      setFormError(t(authErrorMessageKey(code)));
    } finally {
      setOauthLoading(null);
    }
  };

  const errorMessage = (field: keyof SignInInput): string | undefined => {
    const key = errors[field]?.message;
    return key ? t(`auth:${FIELD_ERROR_MESSAGE_KEYS[key] ?? key}`) : undefined;
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
                testID="sign-in-email"
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
                testID="sign-in-password"
                mode="outlined"
                label={t('auth:signIn.password')}
                secureTextEntry={!passwordVisible}
                autoCorrect={false}
                autoCapitalize="none"
                keyboardType="ascii-capable"
                returnKeyType="go"
                onSubmitEditing={() => void onSubmit()}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={Boolean(errors.password)}
                right={
                  <TextInput.Icon
                    icon={passwordVisible ? 'eye-off' : 'eye'}
                    accessibilityLabel={t(
                      passwordVisible ? 'auth:signIn.hidePassword' : 'auth:signIn.showPassword',
                    )}
                    onPress={() => setPasswordVisible((visible) => !visible)}
                  />
                }
              />
              <HelperText type="error" visible={Boolean(errors.password)}>
                {errorMessage('password')}
              </HelperText>
            </View>
          )}
        />

        <Link href="/(auth)/forgot-password" style={styles.forgotLink}>
          <Text style={{ color: theme.colors.primary }}>{t('auth:signIn.forgotPassword')}</Text>
        </Link>

        <HelperText type="error" visible={Boolean(formError)}>
          {formError}
        </HelperText>

        <Button
          testID="sign-in-submit"
          mode="contained"
          onPress={onSubmit}
          loading={isSubmitting}
          style={styles.submit}
        >
          {t('auth:signIn.submit')}
        </Button>

        {(isGoogleAuthEnabled || isAppleAuthEnabled) && (
          <>
            <View style={styles.dividerRow}>
              <Divider style={styles.dividerLine} />
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                {t('auth:signIn.orDivider')}
              </Text>
              <Divider style={styles.dividerLine} />
            </View>

            {isGoogleAuthEnabled && (
              <Button
                mode="outlined"
                icon="google"
                onPress={() => void onOAuthPress('google')}
                loading={oauthLoading === 'google'}
                disabled={oauthLoading !== null}
                style={styles.oauthButton}
              >
                {t('auth:signIn.continueWithGoogle')}
              </Button>
            )}
            {isAppleAuthEnabled && (
              <Button
                mode="outlined"
                icon="apple"
                onPress={() => void onOAuthPress('apple')}
                loading={oauthLoading === 'apple'}
                disabled={oauthLoading !== null}
                style={styles.oauthButton}
              >
                {t('auth:signIn.continueWithApple')}
              </Button>
            )}
          </>
        )}

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
  forgotLink: {
    alignSelf: 'flex-end',
  },
  submit: {
    marginTop: 8,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    marginBottom: 12,
  },
  dividerLine: {
    flex: 1,
  },
  oauthButton: {
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
});
