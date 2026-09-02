import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';

import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { createLogger } from '@/lib/logger/logger';

const logger = createLogger('family-screen');

/**
 * Family Space placeholder. Creating a family and inviting adults is
 * explicitly out of scope for this foundation phase (see
 * docs/ROADMAP.md) — the action below only proves the entry point exists.
 */
export default function FamilyScreen() {
  const { t } = useTranslation('screens');

  return (
    <ScreenContainer>
      <Text variant="headlineSmall" style={styles.title}>
        {t('family.title')}
      </Text>
      <EmptyState
        title={t('family.emptyTitle')}
        description={t('family.emptyDescription')}
        actionLabel={t('family.createFamily')}
        onAction={() => logger.info('create family pressed (not yet implemented)')}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    marginBottom: 8,
  },
});
