import { Link, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';

export default function NotFoundScreen() {
  const { t } = useTranslation('errors');

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('notFound.title') }} />
      <Text variant="titleMedium" style={styles.title}>
        {t('notFound.title')}
      </Text>
      <Link href="/(app)/today" asChild>
        <Button mode="contained" style={styles.action}>
          {t('notFound.back')}
        </Button>
      </Link>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    textAlign: 'center',
    marginTop: 32,
    marginBottom: 16,
  },
  action: {
    alignSelf: 'center',
  },
});
