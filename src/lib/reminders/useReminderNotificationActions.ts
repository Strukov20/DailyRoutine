import { router, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { parseNotificationPayload } from '@/domain/notifications/payload';
import { recurrenceKeys } from '@/domain/recurrence/hooks';
import { completeOccurrence, snoozeOccurrence } from '@/lib/recurrence/recurrenceService';
import { completePersonalTask } from '@/lib/tasks/taskService';
import { createLogger } from '@/lib/logger/logger';
import { useUIStore } from '@/store/uiStore';

import { REMINDER_ACTIONS } from './localNotificationScheduler';

const logger = createLogger('reminder-notification-actions');

/**
 * The dedicated response handler for `task_reminder` payloads (Section 11)
 * — tap-to-navigate AND every notification action (Done/Snooze presets/
 * Custom). Deliberately separate from useNotificationResponseRouter (Phase
 * 6, server-push payloads only): an action button press must call a
 * mutation, not just navigate, and the two payload shapes need different
 * handling for the exact same underlying Notifications listener event.
 *
 * "Tonight"/"Tomorrow" resolve to a fixed, documented local time — 20:00
 * and 09:00 respectively (see docs/DECISIONS.md, "Phase 8") — never a
 * silently-chosen value the UI doesn't also show.
 */
const SNOOZE_TONIGHT_HOUR = 20;
const SNOOZE_TOMORROW_HOUR = 9;

/**
 * "Tonight" must always resolve sooner than "Tomorrow" (`tomorrowAt`,
 * below) — otherwise the two options invert whenever this is called after
 * `hour` has already passed today. Naively rolling the same fixed hour
 * forward by 24h broke that (e.g. tapped at 23:00: "Tonight" -> tomorrow
 * 20:00, "Tomorrow" -> tomorrow 09:00 — "Tonight" landing *after*
 * "Tomorrow"), a real bug this file's own tests caught. Falling back to a
 * short, genuinely-tonight offset from `now` instead keeps it always
 * earlier than `tomorrowAt`'s fixed tomorrow-morning anchor.
 */
function nextLocalTimeToday(hour: number, now: Date): Date {
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  return candidate > now ? candidate : new Date(now.getTime() + 60 * 60 * 1000);
}

function tomorrowAt(hour: number, now: Date): Date {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, 0, 0, 0);
  return tomorrow;
}

export function useReminderNotificationActions(isSignedIn: boolean): void {
  const queryClient = useQueryClient();
  const setPendingNotificationRoute = useUIStore((state) => state.setPendingNotificationRoute);
  const handledIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    async function handleAction(response: Notifications.NotificationResponse) {
      const requestId = response.notification.request.identifier;
      const dedupeKey = `${requestId}:${response.actionIdentifier}`;
      if (handledIdsRef.current.has(dedupeKey)) return; // duplicate callbacks never duplicate the action
      handledIdsRef.current.add(dedupeKey);

      const payload = parseNotificationPayload(response.notification.request.content.data);
      if (!payload || !('notificationType' in payload)) return; // not a task_reminder — the other router handles it

      const { taskId, occurrenceId } = payload;
      const editRoute = `/task/${taskId}/edit`;

      const navigate = () => {
        if (isSignedIn) {
          router.push(editRoute as Href);
        } else {
          setPendingNotificationRoute(editRoute);
        }
      };

      try {
        switch (response.actionIdentifier) {
          case Notifications.DEFAULT_ACTION_IDENTIFIER:
            navigate();
            break;
          case REMINDER_ACTIONS.DONE:
            if (!isSignedIn) {
              navigate(); // an action while signed out can't mutate — fall back to a safe pending route
              break;
            }
            if (occurrenceId) {
              await completeOccurrence(occurrenceId);
            } else {
              await completePersonalTask(taskId);
            }
            void queryClient.invalidateQueries({ queryKey: ['tasks'] });
            break;
          case REMINDER_ACTIONS.SNOOZE_15:
          case REMINDER_ACTIONS.SNOOZE_30:
          case REMINDER_ACTIONS.SNOOZE_60: {
            if (!isSignedIn) {
              navigate();
              break;
            }
            const minutes = { SNOOZE_15: 15, SNOOZE_30: 30, SNOOZE_60: 60 }[response.actionIdentifier];
            await snoozeOccurrence({ taskId, occurrenceId: occurrenceId ?? undefined, minutes });
            void queryClient.invalidateQueries({ queryKey: recurrenceKeys.pendingReminders(taskId) });
            break;
          }
          case REMINDER_ACTIONS.SNOOZE_TONIGHT:
          case REMINDER_ACTIONS.SNOOZE_TOMORROW: {
            if (!isSignedIn) {
              navigate();
              break;
            }
            const now = new Date();
            const until =
              response.actionIdentifier === REMINDER_ACTIONS.SNOOZE_TONIGHT
                ? nextLocalTimeToday(SNOOZE_TONIGHT_HOUR, now)
                : tomorrowAt(SNOOZE_TOMORROW_HOUR, now);
            await snoozeOccurrence({ taskId, occurrenceId: occurrenceId ?? undefined, until: until.toISOString() });
            void queryClient.invalidateQueries({ queryKey: recurrenceKeys.pendingReminders(taskId) });
            break;
          }
          case REMINDER_ACTIONS.CUSTOM:
            // Opens the app to a date/time picker rather than attempting
            // inline native input (brief, Section 1) — the task editor's
            // own date/time fields are that picker; no dedicated screen.
            navigate();
            break;
          default:
            logger.warn('ignored an unrecognized reminder notification action', {
              actionIdentifier: response.actionIdentifier,
            });
        }
      } catch (error) {
        // An action must never be silently reported successful if its
        // mutation failed (brief, Section 11) — logged, not swallowed;
        // there is no UI surface to show an error on from a background
        // action callback, so this is the honest ceiling for this phase.
        logger.warn('reminder notification action failed', {
          actionIdentifier: response.actionIdentifier,
          message: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) void handleAction(response);
      })
      .catch((error: unknown) => {
        logger.warn('failed to read the cold-start notification response', {
          message: error instanceof Error ? error.message : 'unknown',
        });
      });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleAction(response);
    });
    return () => subscription.remove();
  }, [isSignedIn, queryClient, setPendingNotificationRoute]);
}
