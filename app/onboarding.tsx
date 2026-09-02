import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { APP_INFO } from '@/config/appInfo';
import { useAppTheme } from '@/theme';

/**
 * Onboarding placeholder. Real onboarding (explaining Personal vs Family
 * planning, requesting notification permission, etc.) is future work —
 * this screen exists so the app shell has a real first-run entry point
 * instead of dropping straight into auth.
 */
export default function OnboardingScreen() {
  const { t } = useTranslation('common');
  const theme = useAppTheme();

  return (
    <ScreenContainer>
      <View style={styles.content}>
        <Text variant="displaySmall" style={styles.title}>
          {APP_INFO.productName}
        </Text>
        <Text
          variant="bodyLarge"
          style={[styles.tagline, { color: theme.colors.onSurfaceVariant }]}
        >
          {t('tagline')}
        </Text>
        <Link href="/(auth)/sign-in" asChild>
          <Button mode="contained" style={styles.action}>
            {t('actions.continue')}
          </Button>
        </Link>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginBottom: 8,
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
    marginBottom: 32,
  },
  action: {
    minWidth: 200,
  },
});
