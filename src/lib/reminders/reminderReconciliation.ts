import type { Task } from '@/domain/tasks/types';
import type { TaskReminder } from '@/domain/recurrence/types';

import type { LocalNotificationContent, LocalScheduler } from './localNotificationScheduler';

/**
 * The production reconciliation algorithm (Section 12) — diffs "what
 * *should* be scheduled" (derived from reminder definitions + currently-
 * scheduled occurrences) against "what *is* scheduled" (from the injected
 * `LocalScheduler`), and reconciles the difference. Deterministic,
 * idempotent (a repeat call with unchanged inputs schedules/cancels
 * nothing), and scoped to exactly one profile's own keys — it never
 * inspects or cancels a notification whose key doesn't start with this
 * profile's own prefix (Section 12: "protected from scheduling for the
 * wrong account").
 *
 * Pure orchestration over its injected `scheduler` and `now` — this is
 * also, deliberately, the exact function Jest's fake-scheduler integration
 * suite exercises (Section 18: "test the production reconciliation code
 * against a fake native scheduler, not a separate reimplementation").
 */

export interface ReminderReconciliationParams {
  profileId: string;
  reminders: readonly TaskReminder[];
  occurrences: readonly Task[];
  /** The "Show task titles in notifications" preference — defaults to disabled (Section 10). */
  showTitles: boolean;
  scheduler: LocalScheduler;
  now?: Date;
}

export interface ReminderReconciliationResult {
  scheduled: string[];
  cancelled: string[];
  /** Keys that would have fired in the past, or whose occurrence/task is gone — never scheduled, with a reason. */
  skipped: { key: string; reason: 'past' | 'no_occurrence' | 'occurrence_not_timed' }[];
}

interface ExpectedInstance {
  key: string;
  fireDate: Date;
  content: LocalNotificationContent;
}

/** `profileId:taskId:occurrenceKey:reminderId` — Section 8's exact key shape. `occurrenceKey` is the occurrence id, or "series" for a one-off task's own reminder. */
export function buildReminderKey(params: {
  profileId: string;
  taskId: string;
  occurrenceId: string | null;
  reminderId: string;
}): string {
  return `${params.profileId}:${params.taskId}:${params.occurrenceId ?? 'series'}:${params.reminderId}`;
}

function buildContent(task: Task, showTitles: boolean, reminderId: string): LocalNotificationContent {
  return {
    title: showTitles ? task.title : 'FamilyFlow',
    body: showTitles ? task.title : 'Task reminder',
    data: {
      schemaVersion: 1,
      notificationType: 'task_reminder',
      taskId: task.seriesTaskId ?? task.id,
      occurrenceId: task.occurrenceId ?? null,
      reminderId,
    },
  };
}

function occurrenceInstant(occurrence: Task): Date | null {
  if (!occurrence.startTime || !occurrence.date) return null;
  const timeParts = occurrence.startTime.split(':').map(Number);
  const dateParts = occurrence.date.split('-').map(Number);
  const hours = timeParts[0] ?? 0;
  const minutes = timeParts[1] ?? 0;
  const year = dateParts[0] ?? 1970;
  const month = dateParts[1] ?? 1;
  const day = dateParts[2] ?? 1;
  return new Date(year, month - 1, day, hours, minutes);
}

function computeExpectedInstances(
  reminders: readonly TaskReminder[],
  occurrences: readonly Task[],
  showTitles: boolean,
  profileId: string,
  now: Date,
): { expected: ExpectedInstance[]; skipped: ReminderReconciliationResult['skipped'] } {
  const expected: ExpectedInstance[] = [];
  const skipped: ReminderReconciliationResult['skipped'] = [];

  const byIdentity = new Map<string, Task>();
  for (const occurrence of occurrences) {
    byIdentity.set(`${occurrence.seriesTaskId ?? occurrence.id}:${occurrence.occurrenceId ?? 'series'}`, occurrence);
  }

  for (const reminder of reminders) {
    if (reminder.offsetMinutesBefore !== null && !reminder.isSnooze) {
      // A standing relative reminder applies to every currently-scheduled
      // occurrence of its series (definitions are series-wide, never
      // occurrence-scoped — see docs/DECISIONS.md, "Phase 8").
      const seriesOccurrences = occurrences.filter((o) => (o.seriesTaskId ?? o.id) === reminder.taskId);
      for (const occurrence of seriesOccurrences) {
        const key = buildReminderKey({
          profileId,
          taskId: reminder.taskId,
          occurrenceId: occurrence.occurrenceId ?? null,
          reminderId: reminder.id,
        });
        const instant = occurrenceInstant(occurrence);
        if (!instant) {
          skipped.push({ key, reason: 'occurrence_not_timed' });
          continue;
        }
        const fireDate = new Date(instant.getTime() - reminder.offsetMinutesBefore * 60_000);
        if (fireDate <= now) {
          skipped.push({ key, reason: 'past' });
          continue;
        }
        expected.push({ key, fireDate, content: buildContent(occurrence, showTitles, reminder.id) });
      }
    } else if (reminder.remindAt !== null) {
      // Absolute (or snooze, which is always absolute) — exactly one
      // occurrence to attach to, identified by (taskId, occurrenceId).
      const key = buildReminderKey({
        profileId,
        taskId: reminder.taskId,
        occurrenceId: reminder.occurrenceId,
        reminderId: reminder.id,
      });
      const occurrence = byIdentity.get(`${reminder.taskId}:${reminder.occurrenceId ?? 'series'}`);
      if (!occurrence) {
        skipped.push({ key, reason: 'no_occurrence' });
        continue;
      }
      const fireDate = new Date(reminder.remindAt);
      if (fireDate <= now) {
        skipped.push({ key, reason: 'past' });
        continue;
      }
      expected.push({ key, fireDate, content: buildContent(occurrence, showTitles, reminder.id) });
    }
  }

  return { expected, skipped };
}

export async function reconcileReminders(
  params: ReminderReconciliationParams,
): Promise<ReminderReconciliationResult> {
  const now = params.now ?? new Date();
  const { expected, skipped } = computeExpectedInstances(
    params.reminders,
    params.occurrences,
    params.showTitles,
    params.profileId,
    now,
  );

  const actual = (await params.scheduler.listScheduled()).filter((entry) =>
    entry.key.startsWith(`${params.profileId}:`),
  );
  const actualByKey = new Map(actual.map((entry) => [entry.key, entry]));
  const expectedByKey = new Map(expected.map((entry) => [entry.key, entry]));

  const cancelled: string[] = [];
  for (const entry of actual) {
    const stillExpected = expectedByKey.get(entry.key);
    const fireDateMatches = stillExpected && stillExpected.fireDate.getTime() === entry.fireDate.getTime();
    if (!stillExpected || !fireDateMatches) {
      await params.scheduler.cancel(entry.nativeId);
      cancelled.push(entry.key);
    }
  }

  const scheduled: string[] = [];
  for (const entry of expected) {
    const alreadyCorrect = actualByKey.get(entry.key);
    const fireDateMatches = alreadyCorrect && alreadyCorrect.fireDate.getTime() === entry.fireDate.getTime();
    if (!fireDateMatches) {
      await params.scheduler.schedule(entry.key, entry.content, entry.fireDate);
      scheduled.push(entry.key);
    }
  }

  return { scheduled, cancelled, skipped };
}

/** Cancels every one of a profile's own locally-scheduled reminders — logout/account-switch cleanup (Section 8). */
export async function cancelAllRemindersForProfile(
  profileId: string,
  scheduler: LocalScheduler,
): Promise<void> {
  const actual = await scheduler.listScheduled();
  for (const entry of actual) {
    if (entry.key.startsWith(`${profileId}:`)) {
      await scheduler.cancel(entry.nativeId);
    }
  }
}
