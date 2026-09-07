import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Divider, HelperText, List, SegmentedButtons, Text } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { APP_INFO } from '@/config/appInfo';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';
import { AuthServiceError, signOut } from '@/lib/auth/authService';
import { useAuth } from '@/lib/auth/AuthProvider';
import { createLogger } from '@/lib/logger/logger';
import { deactivateCurrentDeviceToken } from '@/lib/notifications/notificationService';
import { useUIStore } from '@/store/uiStore';
import { useAppTheme } from '@/theme';

const logger = createLogger('profile-screen');

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  uk: 'Українська',
};

export default function ProfileScreen() {
  const { t, i18n } = useTranslation(['screens', 'common']);
  const theme = useAppTheme();
  const colorSchemeOverride = useUIStore((state) => state.colorSchemeOverride);
  const setColorSchemeOverride = useUIStore((state) => state.setColorSchemeOverride);
  const { session, profile } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const onSignOut = async () => {
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      // Best-effort, never blocks sign-out (see that function's own
      // comment) — deliberately awaited before signOut() so it still has
      // a valid session to identify "this device's token" with.
      await deactivateCurrentDeviceToken();
      await signOut();
      // No manual navigation needed — AuthProvider flips status to
      // 'signed-out' and the root Stack.Protected guard takes it from
      // there (see app/_layout.tsx).
    } catch (error) {
      const code = error instanceof AuthServiceError ? error.code : 'unknown';
      logger.warn('sign-out failed', { code });
      setSignOutError(t('common:state.somethingWentWrong'));
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <ScreenContainer>
      <Text variant="headlineSmall" style={styles.title}>
        {t('profile.title')}
      </Text>

      <View style={styles.identity}>
        <Text variant="titleMedium">{profile?.displayName ?? session?.user.email}</Text>
        {session?.user.email ? (
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {session.user.email}
          </Text>
        ) : null}
      </View>

      <List.Subheader style={styles.subheader}>{t('profile.language')}</List.Subheader>
      <SegmentedButtons
        value={i18n.language}
        onValueChange={(value) => void i18n.changeLanguage(value)}
        buttons={SUPPORTED_LANGUAGES.map((lang) => ({
          value: lang,
          label: LANGUAGE_LABELS[lang],
        }))}
      />

      <List.Subheader style={styles.subheader}>{t('profile.appearance')}</List.Subheader>
      <SegmentedButtons
        value={colorSchemeOverride}
        onValueChange={(value) => setColorSchemeOverride(value as typeof colorSchemeOverride)}
        buttons={[
          { value: 'system', label: t('profile.appearanceSystem') },
          { value: 'light', label: t('profile.appearanceLight') },
          { value: 'dark', label: t('profile.appearanceDark') },
        ]}
      />

      <Divider style={styles.divider} />

      <List.Item
        testID="profile-notification-settings"
        title={t('notifications:settings.title')}
        left={(props) => <List.Icon {...props} icon="bell-outline" />}
        right={(props) => <List.Icon {...props} icon="chevron-right" />}
        onPress={() => router.push('/notification-settings')}
      />

      <Divider style={styles.divider} />

      <Button
        testID="profile-sign-out"
        mode="outlined"
        onPress={() => void onSignOut()}
        loading={isSigningOut}
        disabled={isSigningOut}
      >
        {t('common:actions.signOut')}
      </Button>
      <HelperText type="error" visible={Boolean(signOutError)}>
        {signOutError}
      </HelperText>

      <Divider style={styles.divider} />

      <View>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('profile.about', { appName: APP_INFO.productName })}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {APP_INFO.tagline}
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    marginBottom: 8,
  },
  identity: {
    marginBottom: 16,
  },
  subheader: {
    paddingHorizontal: 0,
  },
  divider: {
    marginVertical: 24,
  },
});
