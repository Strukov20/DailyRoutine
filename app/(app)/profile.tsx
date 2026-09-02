import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Divider, List, SegmentedButtons, Text } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { APP_INFO } from '@/config/appInfo';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';
import { useUIStore } from '@/store/uiStore';
import { useAppTheme } from '@/theme';

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  uk: 'Українська',
};

export default function ProfileScreen() {
  const { t, i18n } = useTranslation('screens');
  const theme = useAppTheme();
  const colorSchemeOverride = useUIStore((state) => state.colorSchemeOverride);
  const setColorSchemeOverride = useUIStore((state) => state.setColorSchemeOverride);

  return (
    <ScreenContainer>
      <Text variant="headlineSmall" style={styles.title}>
        {t('profile.title')}
      </Text>

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
  subheader: {
    paddingHorizontal: 0,
  },
  divider: {
    marginVertical: 24,
  },
});
