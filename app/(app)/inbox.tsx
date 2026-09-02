import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { FAB, Text } from 'react-native-paper';

import { EmptyState } from '@/components/ui/EmptyState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAppTheme } from '@/theme';

export default function InboxScreen() {
  const { t } = useTranslation('screens');
  const router = useRouter();
  const theme = useAppTheme();

  return (
    <ScreenContainer>
      <Text variant="headlineSmall" style={styles.title}>
        {t('inbox.title')}
      </Text>
      <EmptyState title={t('inbox.emptyTitle')} description={t('inbox.emptyDescription')} />
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        color={theme.colors.onPrimary}
        onPress={() => router.push('/task/new')}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    marginBottom: 8,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
});
