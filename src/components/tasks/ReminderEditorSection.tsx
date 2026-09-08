import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, IconButton, Menu, Text } from 'react-native-paper';

import { useCreateTaskReminder, useDeleteTaskReminder, useTaskReminders } from '@/domain/recurrence/hooks';
import { REMINDER_OFFSET_PRESETS } from '@/domain/recurrence/types';
import { useAppTheme } from '@/theme';

const PRESET_LABEL_KEYS: Record<(typeof REMINDER_OFFSET_PRESETS)[number], string> = {
  0: 'recurrence.reminderAtTime',
  5: 'recurrence.reminder5Min',
  15: 'recurrence.reminder15Min',
  30: 'recurrence.reminder30Min',
  60: 'recurrence.reminder1Hour',
  1440: 'recurrence.reminder1Day',
};

function isPresetOffset(minutes: number): minutes is (typeof REMINDER_OFFSET_PRESETS)[number] {
  return (REMINDER_OFFSET_PRESETS as readonly number[]).includes(minutes);
}

/**
 * The offset picker only ever offers the six presets above, so a
 * non-preset value can only come from data created another way (a future
 * "Custom" picker, or a row from before this UI existed) — translated
 * generically rather than hardcoded, per this codebase's i18n rule.
 */
function formatOffset(minutes: number, t: (key: string, opts?: Record<string, number>) => string): string {
  if (isPresetOffset(minutes)) return t(PRESET_LABEL_KEYS[minutes]);
  if (minutes < 60) return t('recurrence.reminderMinutesBefore', { count: minutes });
  if (minutes % 1440 === 0) return t('recurrence.reminderDaysBefore', { count: minutes / 1440 });
  return t('recurrence.reminderHoursBefore', { count: Math.round(minutes / 60) });
}

interface ReminderEditorSectionProps {
  taskId: string;
  /** Only a timed task (start_time set) can have a relative reminder — see docs/DECISIONS.md, "Phase 8." */
  hasStartTime: boolean;
}

/**
 * "Reminders" section of the task editor (Section 13) — add/remove
 * standing reminder definitions for an existing task. A newly-created
 * task has no reminders yet by construction (reminders need a real
 * task_id to attach to); this section only renders once editing an
 * already-saved task, per TaskEditorForm's own wiring.
 */
export function ReminderEditorSection({ taskId, hasStartTime }: ReminderEditorSectionProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const theme = useAppTheme();
  const remindersQuery = useTaskReminders(taskId);
  const createReminder = useCreateTaskReminder();
  const deleteReminder = useDeleteTaskReminder(taskId);
  const [menuVisible, setMenuVisible] = useState(false);

  const reminders = remindersQuery.data ?? [];
  const existingOffsets = new Set(reminders.map((r) => r.offsetMinutesBefore).filter((v): v is number => v !== null));

  const addPreset = (minutes: number) => {
    setMenuVisible(false);
    if (existingOffsets.has(minutes)) return; // duplicate-time prevention
    void createReminder.mutateAsync({ taskId, offsetMinutesBefore: minutes });
  };

  return (
    <View style={styles.container}>
      <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
        {t('tasks:recurrence.remindersField')}
      </Text>

      {!hasStartTime ? (
        <HelperText type="info" visible>
          {t('tasks:recurrence.reminderRequiresTime')}
        </HelperText>
      ) : null}

      {reminders.map((reminder) => (
        <View key={reminder.id} style={styles.row} testID={`reminder-row-${reminder.id}`}>
          <Text variant="bodyMedium" style={styles.rowText}>
            {reminder.offsetMinutesBefore !== null
              ? formatOffset(reminder.offsetMinutesBefore, t)
              : reminder.remindAt}
          </Text>
          <IconButton
            icon="close"
            size={18}
            accessibilityLabel={t('tasks:recurrence.removeReminder')}
            onPress={() => void deleteReminder.mutateAsync(reminder.id)}
          />
        </View>
      ))}

      {hasStartTime ? (
        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchor={
            <Button
              testID="add-reminder-button"
              mode="outlined"
              icon="bell-plus-outline"
              onPress={() => setMenuVisible(true)}
            >
              {t('tasks:recurrence.addReminder')}
            </Button>
          }
        >
          {REMINDER_OFFSET_PRESETS.map((minutes) => (
            <Menu.Item
              key={minutes}
              title={t(PRESET_LABEL_KEYS[minutes])}
              disabled={existingOffsets.has(minutes)}
              onPress={() => addPreset(minutes)}
            />
          ))}
        </Menu>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  label: { marginTop: 16, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rowText: { flex: 1 },
});
