import type { Task } from '@/domain/tasks/types';
import type { TaskReminder } from '@/domain/recurrence/types';

import type { LocalNotificationContent, LocalScheduler, ScheduledLocalNotification } from './localNotificationScheduler';
import { buildReminderKey, cancelAllRemindersForProfile, reconcileReminders } from './reminderReconciliation';

const PROFILE = 'profile-1';
// Local-constructed, like every occurrence instant reconciliation itself
// computes (see occurrenceInstant()) — mixing this with a UTC ISO string
// would make the comparison timezone-dependent on whatever machine runs
// the suite. Clearly before every occurrence fixture's own 09:00 local.
const NOW = new Date(2026, 8, 9, 0, 0);

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'occ-1',
    ownerProfileId: PROFILE,
    familyId: null,
    title: 'Take vitamins',
    description: null,
    date: '2026-09-10',
    startTime: '09:00:00',
    durationMinutes: null,
    timezone: 'Europe/Kyiv',
    priority: 'normal',
    categoryId: null,
    visibility: 'private',
    completedAt: null,
    createdAt: '2026-09-10',
    updatedAt: '2026-09-10',
    assigneeMemberId: null,
    assignmentStatus: 'unassigned',
    occurrenceId: 'occ-1',
    seriesTaskId: 'task-1',
    isRecurring: true,
    rescheduled: false,
    ...overrides,
  };
}

function reminder(overrides: Partial<TaskReminder> = {}): TaskReminder {
  return {
    id: 'reminder-1',
    taskId: 'task-1',
    profileId: PROFILE,
    remindAt: null,
    offsetMinutesBefore: 15,
    occurrenceId: null,
    isSnooze: false,
    label: null,
    createdAt: '2026-09-01',
    ...overrides,
  };
}

/** An in-memory fake — the real production scheduler interface, no reimplementation of reconciliation logic. */
class FakeScheduler implements LocalScheduler {
  private nextId = 1;
  entries = new Map<string, ScheduledLocalNotification>();
  scheduleCalls: { key: string; content: LocalNotificationContent; fireDate: Date }[] = [];
  cancelCalls: string[] = [];

  async schedule(key: string, content: LocalNotificationContent, fireDate: Date): Promise<string> {
    const nativeId = `native-${this.nextId++}`;
    this.entries.set(nativeId, { nativeId, key, fireDate });
    this.scheduleCalls.push({ key, content, fireDate });
    return nativeId;
  }

  async cancel(nativeId: string): Promise<void> {
    this.entries.delete(nativeId);
    this.cancelCalls.push(nativeId);
  }

  async listScheduled(): Promise<ScheduledLocalNotification[]> {
    return Array.from(this.entries.values());
  }

  seed(key: string, fireDate: Date): string {
    const nativeId = `native-${this.nextId++}`;
    this.entries.set(nativeId, { nativeId, key, fireDate });
    return nativeId;
  }
}

describe('buildReminderKey', () => {
  it('is deterministic and includes profileId/taskId/occurrenceId/reminderId', () => {
    expect(
      buildReminderKey({ profileId: 'p1', taskId: 't1', occurrenceId: 'o1', reminderId: 'r1' }),
    ).toBe('p1:t1:o1:r1');
  });

  it('uses "series" as the occurrence segment for a one-off task reminder', () => {
    expect(
      buildReminderKey({ profileId: 'p1', taskId: 't1', occurrenceId: null, reminderId: 'r1' }),
    ).toBe('p1:t1:series:r1');
  });
});

describe('reconcileReminders', () => {
  it('schedules a relative reminder for a future timed occurrence', async () => {
    const scheduler = new FakeScheduler();
    const result = await reconcileReminders({
      profileId: PROFILE,
      reminders: [reminder({ offsetMinutesBefore: 15 })],
      occurrences: [task()],
      showTitles: false,
      scheduler,
      now: NOW,
    });

    expect(result.scheduled).toEqual(['profile-1:task-1:occ-1:reminder-1']);
    expect(scheduler.scheduleCalls).toHaveLength(1);
    // 09:00 Kyiv wall time minus 15 minutes = 08:45 (device-local interpretation, see docs/DECISIONS.md).
    expect(scheduler.scheduleCalls[0]?.fireDate).toEqual(new Date(2026, 8, 10, 8, 45));
  });

  it('never includes a task title/description in notification content when showTitles is false', async () => {
    const scheduler = new FakeScheduler();
    await reconcileReminders({
      profileId: PROFILE,
      reminders: [reminder()],
      occurrences: [task({ title: 'SECRET-therapy-appointment' })],
      showTitles: false,
      scheduler,
      now: NOW,
    });

    const call = scheduler.scheduleCalls[0];
    expect(call?.content.title).toBe('FamilyFlow');
    expect(call?.content.body).toBe('Task reminder');
    expect(JSON.stringify(call?.content)).not.toContain('SECRET-therapy-appointment');
  });

  it('includes the task title when showTitles is true', async () => {
    const scheduler = new FakeScheduler();
    await reconcileReminders({
      profileId: PROFILE,
      reminders: [reminder()],
      occurrences: [task({ title: 'Take vitamins' })],
      showTitles: true,
      scheduler,
      now: NOW,
    });

    expect(scheduler.scheduleCalls[0]?.content.body).toBe('Take vitamins');
  });

  it('is idempotent: a second call with unchanged inputs schedules and cancels nothing', async () => {
    const scheduler = new FakeScheduler();
    const params = {
      profileId: PROFILE,
      reminders: [reminder()],
      occurrences: [task()],
      showTitles: false,
      scheduler,
      now: NOW,
    };
    await reconcileReminders(params);
    const second = await reconcileReminders(params);

    expect(second.scheduled).toEqual([]);
    expect(second.cancelled).toEqual([]);
  });

  it('cancels a stale scheduled notification once its reminder definition is gone', async () => {
    const scheduler = new FakeScheduler();
    scheduler.seed('profile-1:task-1:occ-1:reminder-1', new Date(2026, 8, 10, 8, 45));

    const result = await reconcileReminders({
      profileId: PROFILE,
      reminders: [], // reminder deleted
      occurrences: [task()],
      showTitles: false,
      scheduler,
      now: NOW,
    });

    expect(result.cancelled).toEqual(['profile-1:task-1:occ-1:reminder-1']);
  });

  it('reschedules (cancel + schedule) when the occurrence time changes', async () => {
    const scheduler = new FakeScheduler();
    scheduler.seed('profile-1:task-1:occ-1:reminder-1', new Date(2026, 8, 10, 8, 45));

    const result = await reconcileReminders({
      profileId: PROFILE,
      reminders: [reminder()],
      occurrences: [task({ startTime: '10:00:00' })], // rescheduled an hour later
      showTitles: false,
      scheduler,
      now: NOW,
    });

    expect(result.cancelled).toEqual(['profile-1:task-1:occ-1:reminder-1']);
    expect(result.scheduled).toEqual(['profile-1:task-1:occ-1:reminder-1']);
    expect(scheduler.scheduleCalls.at(-1)?.fireDate).toEqual(new Date(2026, 8, 10, 9, 45));
  });

  it('schedules a snooze reminder as a one-time absolute instance, distinct from the standing definition', async () => {
    const scheduler = new FakeScheduler();
    const snoozeAt = new Date('2026-09-10T09:00:00.000Z');
    const result = await reconcileReminders({
      profileId: PROFILE,
      reminders: [
        reminder(), // standing relative definition
        reminder({ id: 'snooze-1', isSnooze: true, offsetMinutesBefore: null, remindAt: snoozeAt.toISOString(), occurrenceId: 'occ-1' }),
      ],
      occurrences: [task()],
      showTitles: false,
      scheduler,
      now: NOW,
    });

    expect(result.scheduled.sort()).toEqual(
      ['profile-1:task-1:occ-1:reminder-1', 'profile-1:task-1:occ-1:snooze-1'].sort(),
    );
    const snoozeCall = scheduler.scheduleCalls.find((c) => c.key.endsWith('snooze-1'));
    expect(snoozeCall?.fireDate).toEqual(snoozeAt);
  });

  it('never schedules a reminder whose computed fire time has already passed', async () => {
    const scheduler = new FakeScheduler();
    const result = await reconcileReminders({
      profileId: PROFILE,
      reminders: [reminder({ offsetMinutesBefore: 0 })],
      occurrences: [task({ date: '2026-09-01', startTime: '09:00:00' })], // long before `now`
      showTitles: false,
      scheduler,
      now: NOW,
    });

    expect(result.scheduled).toEqual([]);
    expect(result.skipped).toEqual([{ key: 'profile-1:task-1:occ-1:reminder-1', reason: 'past' }]);
  });

  it('never schedules a relative reminder against an occurrence with no start_time (Anytime)', async () => {
    const scheduler = new FakeScheduler();
    const result = await reconcileReminders({
      profileId: PROFILE,
      reminders: [reminder()],
      occurrences: [task({ startTime: null })],
      showTitles: false,
      scheduler,
      now: NOW,
    });

    expect(result.scheduled).toEqual([]);
    expect(result.skipped).toEqual([
      { key: 'profile-1:task-1:occ-1:reminder-1', reason: 'occurrence_not_timed' },
    ]);
  });

  it('never schedules an absolute/snooze reminder whose occurrence is no longer in the scheduled set (completed/skipped/deleted)', async () => {
    const scheduler = new FakeScheduler();
    const result = await reconcileReminders({
      profileId: PROFILE,
      reminders: [reminder({ isSnooze: true, offsetMinutesBefore: null, remindAt: '2026-09-10T09:00:00.000Z', occurrenceId: 'occ-gone' })],
      occurrences: [task()], // occ-1 only — occ-gone is absent (completed/skipped/deleted)
      showTitles: false,
      scheduler,
      now: NOW,
    });

    expect(result.scheduled).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('no_occurrence');
  });

  it('applies a standing relative reminder to every currently-scheduled occurrence of its series', async () => {
    const scheduler = new FakeScheduler();
    const result = await reconcileReminders({
      profileId: PROFILE,
      reminders: [reminder()],
      occurrences: [
        task({ id: 'occ-1', occurrenceId: 'occ-1', date: '2026-09-10' }),
        task({ id: 'occ-2', occurrenceId: 'occ-2', date: '2026-09-12' }),
      ],
      showTitles: false,
      scheduler,
      now: NOW,
    });

    expect(result.scheduled.sort()).toEqual(
      ['profile-1:task-1:occ-1:reminder-1', 'profile-1:task-1:occ-2:reminder-1'].sort(),
    );
  });

  it('never touches another profile-account\'s scheduled notifications (account-switch safety)', async () => {
    const scheduler = new FakeScheduler();
    scheduler.seed('other-profile:task-x:occ-x:reminder-x', new Date(2026, 8, 15));

    const result = await reconcileReminders({
      profileId: PROFILE,
      reminders: [],
      occurrences: [],
      showTitles: false,
      scheduler,
      now: NOW,
    });

    expect(result.cancelled).toEqual([]);
    expect(scheduler.cancelCalls).toEqual([]);
  });
});

describe('cancelAllRemindersForProfile', () => {
  it('cancels only the given profile\'s own scheduled reminders, never another account\'s', async () => {
    const scheduler = new FakeScheduler();
    scheduler.seed('profile-1:task-1:occ-1:reminder-1', new Date(2026, 8, 10));
    scheduler.seed('profile-1:task-2:series:reminder-2', new Date(2026, 8, 11));
    scheduler.seed('other-profile:task-x:occ-x:reminder-x', new Date(2026, 8, 12));

    await cancelAllRemindersForProfile(PROFILE, scheduler);

    const remaining = await scheduler.listScheduled();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.key).toBe('other-profile:task-x:occ-x:reminder-x');
  });
});
