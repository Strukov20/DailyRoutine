import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';

/**
 * Day-view placeholder for the foundation phase. Week/Month views and
 * external calendar integration are V2 scope — see docs/ROADMAP.md.
 */
export default function CalendarScreen() {
  const { t } = useTranslation('screens');

  return (
    <ScreenContainer>
      <Text variant="headlineSmall" style={styles.title}>
        {t('calendar.title')}
      </Text>
      <EmptyState title={t('calendar.emptyTitle')} description={t('calendar.emptyDescription')} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    marginBottom: 8,
  },
});
