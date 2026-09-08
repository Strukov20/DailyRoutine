import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  getReminderTitlesPreference,
  getNotificationPermissionStatus,
  requestNotificationPermission,
} from '@/lib/notifications/notificationService';
import { listAllPendingReminders, listAllScheduledOccurrences } from '@/lib/recurrence/recurrenceService';
import {
  expoLocalScheduler,
  type ScheduledLocalNotification,
} from '@/lib/reminders/localNotificationScheduler';
import { reconcileReminders } from '@/lib/reminders/reminderReconciliation';

/**
 * Dev-only diagnostic screen (`__DEV__`-gated, absent from any production
 * build) for exercising the *production* local-reminder scheduler and
 * reconciliation code without depending on `ReminderEditorSection`'s
 * `react-native-paper` `<Menu>` — see docs/DECISIONS.md, "Phase 8," for why
 * that Menu is unreliable under both Jest and live Maestro automation.
 * Every function called here is the real production implementation
 * (`requestNotificationPermission`, `reconcileReminders`,
 * `expoLocalScheduler.listScheduled`) — nothing is reimplemented or mocked.
 * Only ids/keys/fire times are ever displayed — never a reminder's task
 * title (see docs/SECURITY_AND_PRIVACY.md, Mechanism 4c/5).
 */
export default function DevDiagnosticsScreen() {
  if (!__DEV__) return null;
  return <DevDiagnosticsScreenInner />;
}

function DevDiagnosticsScreenInner() {
  const { profile } = useAuth();
  const [log, setLog] = useState<string[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledLocalNotification[]>([]);

  const append = (line: string) => setLog((prev) => [...prev, line]);

  const onRequestPermission = async () => {
    const before = await getNotificationPermissionStatus();
    append(`permission before: ${before}`);
    const after = await requestNotificationPermission();
    append(`permission after: ${after}`);
  };

  const onReconcileNow = async () => {
    if (!profile) {
      append('no signed-in profile');
      return;
    }
    const [reminders, occurrences, showTitles] = await Promise.all([
      listAllPendingReminders(profile.id),
      listAllScheduledOccurrences(profile.id),
      getReminderTitlesPreference(),
    ]);
    append(`reconcile input: ${reminders.length} reminder def(s), ${occurrences.length} occurrence(s)`);
    const result = await reconcileReminders({
      profileId: profile.id,
      reminders,
      occurrences,
      showTitles,
      scheduler: expoLocalScheduler,
    });
    append(
      `reconcile result: scheduled=${result.scheduled.length} cancelled=${result.cancelled.length} skipped=${result.skipped.length}`,
    );
    for (const s of result.skipped) append(`  skipped ${s.key} (${s.reason})`);
  };

  const onListScheduled = async () => {
    const rows = await expoLocalScheduler.listScheduled();
    setScheduled(rows);
    append(`listScheduled: ${rows.length} native request(s)`);
  };

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: 'Dev diagnostics', headerShown: true }} />
      <Text variant="bodySmall" style={styles.warning}>
        __DEV__-only. Never shipped in a production build.
      </Text>

      <Button mode="outlined" onPress={() => void onRequestPermission()} style={styles.action}>
        Request notification permission
      </Button>
      <Button mode="outlined" onPress={() => void onReconcileNow()} style={styles.action}>
        Run reconcileReminders() now
      </Button>
      <Button mode="outlined" onPress={() => void onListScheduled()} style={styles.action}>
        List scheduled (native)
      </Button>

      <Text variant="labelMedium" style={styles.sectionLabel}>
        Scheduled native requests (id / key / fireDate only — never a title)
      </Text>
      {scheduled.map((s) => (
        <View key={s.nativeId} style={styles.row}>
          <Text variant="bodySmall">{s.nativeId}</Text>
          <Text variant="bodySmall">{s.key}</Text>
          <Text variant="bodySmall">{s.fireDate.toISOString()}</Text>
        </View>
      ))}

      <Text variant="labelMedium" style={styles.sectionLabel}>
        Log
      </Text>
      <ScrollView style={styles.log}>
        {log.map((line, i) => (
          <Text key={i} variant="bodySmall" testID={`dev-diagnostics-log-${i}`}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  warning: { marginBottom: 8, opacity: 0.6 },
  action: { marginTop: 8 },
  sectionLabel: { marginTop: 16, marginBottom: 4 },
  row: { paddingVertical: 2 },
  log: { marginTop: 4, maxHeight: 300 },
});
