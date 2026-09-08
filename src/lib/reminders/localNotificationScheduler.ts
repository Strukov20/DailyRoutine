import * as Notifications from 'expo-notifications';

import { createLogger } from '@/lib/logger/logger';

const logger = createLogger('local-notification-scheduler');

/**
 * The testable boundary around `expo-notifications` for Phase 8's local
 * reminder scheduling (Section 8) — screens/hooks never call
 * `expo-notifications` directly, only through this interface (and, for
 * production, its one real implementation below). Jest tests inject a fake
 * implementation of this same interface against the real reconciliation
 * code (see src/lib/reminders/reminderReconciliation.ts) — never a
 * separately reimplemented mock of the reconciliation logic itself.
 */
export interface LocalNotificationContent {
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export interface ScheduledLocalNotification {
  nativeId: string;
  /** Our own deterministic logical key (see reminderKeys.ts) — never the opaque native id. */
  key: string;
  fireDate: Date;
}

export interface LocalScheduler {
  schedule(key: string, content: LocalNotificationContent, fireDate: Date): Promise<string>;
  cancel(nativeId: string): Promise<void>;
  listScheduled(): Promise<ScheduledLocalNotification[]>;
}

/** Every action a reminder notification can carry — Section 11's fixed set, plus the OS default (a plain tap). */
export const REMINDER_ACTIONS = {
  DONE: 'DONE',
  SNOOZE_15: 'SNOOZE_15',
  SNOOZE_30: 'SNOOZE_30',
  SNOOZE_60: 'SNOOZE_60',
  SNOOZE_TONIGHT: 'SNOOZE_TONIGHT',
  SNOOZE_TOMORROW: 'SNOOZE_TOMORROW',
  CUSTOM: 'CUSTOM',
} as const;

export const REMINDER_NOTIFICATION_CATEGORY = 'task_reminder.v1';

/**
 * Registers the notification category (Section 11) — call once at app
 * startup, after the reminders preference is known to be relevant (no
 * earlier than permission is first requested, matching Section 9's "never
 * request permission on app startup" — registering the *category* itself
 * needs no permission and is safe to call unconditionally, but is kept
 * alongside scheduling code for a single, obvious call site).
 */
export async function ensureReminderNotificationCategory(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(REMINDER_NOTIFICATION_CATEGORY, [
      { identifier: REMINDER_ACTIONS.DONE, buttonTitle: 'Done', options: { opensAppToForeground: false } },
      { identifier: REMINDER_ACTIONS.SNOOZE_15, buttonTitle: '+15 min', options: { opensAppToForeground: false } },
      { identifier: REMINDER_ACTIONS.SNOOZE_30, buttonTitle: '+30 min', options: { opensAppToForeground: false } },
      { identifier: REMINDER_ACTIONS.SNOOZE_60, buttonTitle: '+1 hour', options: { opensAppToForeground: false } },
      {
        identifier: REMINDER_ACTIONS.SNOOZE_TONIGHT,
        buttonTitle: 'Tonight',
        options: { opensAppToForeground: false },
      },
      {
        identifier: REMINDER_ACTIONS.SNOOZE_TOMORROW,
        buttonTitle: 'Tomorrow',
        options: { opensAppToForeground: false },
      },
      { identifier: REMINDER_ACTIONS.CUSTOM, buttonTitle: 'Custom', options: { opensAppToForeground: true } },
    ]);
  } catch (error) {
    logger.warn('failed to register the reminder notification category', {
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}

/**
 * The real, `expo-notifications`-backed scheduler. `fireDate` is embedded
 * in `data.reminderFireAtMs` at schedule time and read back from there in
 * `listScheduled()` — deliberately not re-derived from the native trigger
 * object, whose shape is platform-specific and not worth parsing when the
 * value is already known at schedule time.
 */
export const expoLocalScheduler: LocalScheduler = {
  async schedule(key, content, fireDate) {
    return Notifications.scheduleNotificationAsync({
      content: {
        title: content.title,
        body: content.body,
        data: { ...content.data, reminderKey: key, reminderFireAtMs: fireDate.getTime() },
        categoryIdentifier: REMINDER_NOTIFICATION_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireDate,
      },
    });
  },

  async cancel(nativeId) {
    await Notifications.cancelScheduledNotificationAsync(nativeId);
  },

  async listScheduled() {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    const result: ScheduledLocalNotification[] = [];
    for (const request of requests) {
      const data = request.content.data as Record<string, unknown> | undefined;
      const key = data?.reminderKey;
      const fireAtMs = data?.reminderFireAtMs;
      if (typeof key !== 'string' || typeof fireAtMs !== 'number') continue; // not one of ours
      result.push({ nativeId: request.identifier, key, fireDate: new Date(fireAtMs) });
    }
    return result;
  },
};
