import { Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, List, Switch, Text } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import {
  useNotificationPermissionStatus,
  useNotificationPreference,
  useRegisterPushNotifications,
  useSetNotificationPreference,
} from '@/domain/notifications/hooks';
import { NotificationServiceError, openSystemNotificationSettings } from '@/lib/notifications/notificationService';
import { useAppTheme } from '@/theme';

/**
 * Profile -> Notifications. Permission is requested only from here, on a
 * deliberate tap — never automatically on app launch (see
 * docs/DECISIONS.md, "Phase 6").
 */
export default function NotificationSettingsScreen() {
  const { t } = useTranslation(['notifications', 'common']);
  const theme = useAppTheme();

  const permissionQuery = useNotificationPermissionStatus();
  const registerMutation = useRegisterPushNotifications();
  const preferenceQuery = useNotificationPreference();
  const setPreferenceMutation = useSetNotificationPreference();

  const [registrationErrorKey, setRegistrationErrorKey] = useState<string | null>(null);

  const onEnable = async () => {
    setRegistrationErrorKey(null);
    try {
      await registerMutation.mutateAsync();
    } catch (error) {
      const code = error instanceof NotificationServiceError ? error.code : 'unknown';
      setRegistrationErrorKey(
        {
          unsupported: 'settings.statusUnsupported',
          permission_denied: 'settings.statusDenied',
          missing_project_id: 'settings.errorMissingProjectId',
          registration_failed: 'settings.errorRegistrationFailed',
          unknown: 'settings.errorUnknown',
        }[code],
      );
    }
  };

  const statusTextKey = (() => {
    if (permissionQuery.isLoading) return 'settings.statusUnknown';
    if (permissionQuery.data === 'denied') return 'settings.statusDenied';
    if (permissionQuery.data === 'granted' && registerMutation.isSuccess) return 'settings.statusRegistered';
    return 'settings.statusNotRegistered';
  })();

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('settings.title'), headerShown: true }} />

      <List.Subheader style={styles.subheader}>{t('settings.pushSection')}</List.Subheader>
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {t(statusTextKey)}
      </Text>

      {permissionQuery.data === 'denied' ? (
        <Button
          testID="notification-settings-open-system-settings"
          mode="outlined"
          onPress={() => void openSystemNotificationSettings()}
          style={styles.action}
        >
          {t('settings.openSettingsAction')}
        </Button>
      ) : (
        <Button
          testID="notification-settings-enable"
          mode="contained"
          onPress={() => void onEnable()}
          loading={registerMutation.isPending}
          disabled={registerMutation.isPending || (permissionQuery.data === 'granted' && registerMutation.isSuccess)}
          style={styles.action}
        >
          {t('settings.enableAction')}
        </Button>
      )}
      <HelperText type="error" visible={Boolean(registrationErrorKey)}>
        {registrationErrorKey ? t(registrationErrorKey) : ''}
      </HelperText>

      <List.Subheader style={styles.subheader}>{t('settings.preferenceSection')}</List.Subheader>
      <View style={styles.preferenceRow}>
        <View style={styles.preferenceText}>
          <Text variant="bodyMedium">{t('settings.assignmentPreferenceLabel')}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('settings.assignmentPreferenceDescription')}
          </Text>
        </View>
        <Switch
          testID="notification-settings-assignment-preference"
          value={preferenceQuery.data ?? true}
          disabled={preferenceQuery.isLoading || setPreferenceMutation.isPending}
          onValueChange={(value) => setPreferenceMutation.mutate(value)}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  subheader: {
    paddingHorizontal: 0,
  },
  action: {
    marginTop: 8,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  preferenceText: {
    flex: 1,
    gap: 2,
  },
});
