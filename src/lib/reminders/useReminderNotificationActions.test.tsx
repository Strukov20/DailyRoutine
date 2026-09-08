import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import type { ReactNode } from 'react';

import { useUIStore } from '@/store/uiStore';

import { useReminderNotificationActions } from './useReminderNotificationActions';

const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const mockCompleteOccurrence = jest.fn();
const mockSnoozeOccurrence = jest.fn();
jest.mock('@/lib/recurrence/recurrenceService', () => ({
  completeOccurrence: (...args: unknown[]) => mockCompleteOccurrence(...args),
  snoozeOccurrence: (...args: unknown[]) => mockSnoozeOccurrence(...args),
}));

const mockCompletePersonalTask = jest.fn();
jest.mock('@/lib/tasks/taskService', () => ({
  completePersonalTask: (...args: unknown[]) => mockCompletePersonalTask(...args),
}));

// Explicit factory, not automock: the real module transitively imports
// @/lib/auth/AuthProvider -> @/lib/supabase/client -> AsyncStorage, which
// has no native module under Jest (see docs/TEST_STRATEGY.md, "Mock a
// service module with an explicit factory..."). Only the plain `recurrenceKeys`
// object is actually used by the hook under test.
jest.mock('@/domain/recurrence/hooks', () => ({
  recurrenceKeys: {
    reminders: (taskId: string) => ['recurrence', 'reminders', taskId] as const,
    pendingReminders: (profileId: string) => ['recurrence', 'pending-reminders', profileId] as const,
    scheduledOccurrences: (profileId: string) => ['recurrence', 'scheduled-occurrences', profileId] as const,
  },
}));

function makeResponse(identifier: string, actionIdentifier: string, data: unknown) {
  return {
    actionIdentifier,
    notification: { request: { identifier, content: { data } } },
  } as unknown as Notifications.NotificationResponse;
}

function latestListener(): (response: Notifications.NotificationResponse) => void {
  const mock = Notifications.addNotificationResponseReceivedListener as jest.Mock;
  const calls = mock.mock.calls;
  const [cb] = calls[calls.length - 1] as [(response: Notifications.NotificationResponse) => void];
  return cb;
}

const REMINDER_DATA = {
  schemaVersion: 1,
  notificationType: 'task_reminder',
  taskId: '22222222-2222-4222-8222-222222222222',
  occurrenceId: '33333333-3333-4333-8333-333333333333',
  reminderId: '55555555-5555-4555-8555-555555555555',
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useReminderNotificationActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUIStore.setState({ pendingNotificationRoute: null });
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(null);
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation(() => ({
      remove: jest.fn(),
    }));
    mockCompleteOccurrence.mockResolvedValue(undefined);
    mockSnoozeOccurrence.mockResolvedValue('new-reminder-id');
    mockCompletePersonalTask.mockResolvedValue(undefined);
  });

  it('navigates to the task edit screen on a plain tap (DEFAULT_ACTION_IDENTIFIER)', async () => {
    await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(makeResponse('resp-1', DEFAULT_ACTION_IDENTIFIER, REMINDER_DATA));
    });

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/task/22222222-2222-4222-8222-222222222222/edit');
    });
    expect(mockCompleteOccurrence).not.toHaveBeenCalled();
  });

  it('DONE completes the referenced occurrence only, never the whole task/series', async () => {
    await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(makeResponse('resp-2', 'DONE', REMINDER_DATA));
    });

    await waitFor(() => expect(mockCompleteOccurrence).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333'));
    expect(mockCompletePersonalTask).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('DONE completes the task directly for a one-off reminder (occurrenceId null)', async () => {
    await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(makeResponse('resp-3', 'DONE', { ...REMINDER_DATA, occurrenceId: null }));
    });

    await waitFor(() =>
      expect(mockCompletePersonalTask).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222'),
    );
    expect(mockCompleteOccurrence).not.toHaveBeenCalled();
  });

  it.each(['SNOOZE_15', 'SNOOZE_30', 'SNOOZE_60'])('%s snoozes with the matching minute count', async (action) => {
    await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
    const expectedMinutes = { SNOOZE_15: 15, SNOOZE_30: 30, SNOOZE_60: 60 }[action];

    await act(async () => {
      latestListener()(makeResponse(`resp-${action}`, action, REMINDER_DATA));
    });

    await waitFor(() =>
      expect(mockSnoozeOccurrence).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: '22222222-2222-4222-8222-222222222222',
          occurrenceId: '33333333-3333-4333-8333-333333333333',
          minutes: expectedMinutes,
        }),
      ),
    );
  });

  // "Tonight"/"Tomorrow" resolve real wall-clock time (see
  // useReminderNotificationActions.ts) - a test that never fixes `now`
  // is at the mercy of whatever time it happens to run, which is exactly
  // how a real ordering bug (below) went unnoticed until this suite ran
  // late at night. Every test in this block fixes system time explicitly.
  describe('SNOOZE_TONIGHT and SNOOZE_TOMORROW', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('snooze with a computed future `until`, never `minutes`, and Tonight is always sooner than Tomorrow (called at midday)', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 0, 15, 13, 0, 0)); // 13:00, well before the 20:00 "tonight" anchor

      await renderHook(() => useReminderNotificationActions(true), { wrapper });
      await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

      await act(async () => {
        latestListener()(makeResponse('resp-tonight', 'SNOOZE_TONIGHT', REMINDER_DATA));
      });
      await waitFor(() => expect(mockSnoozeOccurrence).toHaveBeenCalledTimes(1));
      const tonightCall = mockSnoozeOccurrence.mock.calls[0]?.[0];
      expect(tonightCall.minutes).toBeUndefined();
      expect(new Date(tonightCall.until).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(tonightCall.until).getHours()).toBe(20); // the documented fixed hour, reached normally

      await act(async () => {
        latestListener()(makeResponse('resp-tomorrow', 'SNOOZE_TOMORROW', REMINDER_DATA));
      });
      await waitFor(() => expect(mockSnoozeOccurrence).toHaveBeenCalledTimes(2));
      const tomorrowCall = mockSnoozeOccurrence.mock.calls[1]?.[0];
      expect(new Date(tomorrowCall.until).getTime()).toBeGreaterThan(new Date(tonightCall.until).getTime());
    });

    it('Tonight still resolves sooner than Tomorrow when tapped after the 20:00 anchor has already passed (real bug, found and fixed this session)', async () => {
      // 23:00 - past tonight's fixed 20:00 anchor. Naively rolling the same
      // fixed hour forward by 24h would land "Tonight" at tomorrow 20:00 -
      // *after* "Tomorrow" (tomorrow 09:00), inverting the two options.
      jest.useFakeTimers().setSystemTime(new Date(2026, 0, 15, 23, 0, 0));

      await renderHook(() => useReminderNotificationActions(true), { wrapper });
      await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

      await act(async () => {
        latestListener()(makeResponse('resp-tonight-late', 'SNOOZE_TONIGHT', REMINDER_DATA));
      });
      await waitFor(() => expect(mockSnoozeOccurrence).toHaveBeenCalledTimes(1));
      const tonightCall = mockSnoozeOccurrence.mock.calls[0]?.[0];
      expect(new Date(tonightCall.until).getTime()).toBeGreaterThan(Date.now());

      await act(async () => {
        latestListener()(makeResponse('resp-tomorrow-late', 'SNOOZE_TOMORROW', REMINDER_DATA));
      });
      await waitFor(() => expect(mockSnoozeOccurrence).toHaveBeenCalledTimes(2));
      const tomorrowCall = mockSnoozeOccurrence.mock.calls[1]?.[0];

      expect(new Date(tomorrowCall.until).getTime()).toBeGreaterThan(new Date(tonightCall.until).getTime());
    });
  });

  it('CUSTOM opens the app to the task editor rather than attempting inline input', async () => {
    await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(makeResponse('resp-custom', 'CUSTOM', REMINDER_DATA));
    });

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/task/22222222-2222-4222-8222-222222222222/edit');
    });
    expect(mockSnoozeOccurrence).not.toHaveBeenCalled();
    expect(mockCompleteOccurrence).not.toHaveBeenCalled();
  });

  it('ignores a malformed/unrecognized payload safely — no mutation, no navigation, no throw', async () => {
    await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(makeResponse('resp-bad', 'DONE', { unexpected: 'shape' }));
    });

    expect(mockCompleteOccurrence).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('ignores a server-push payload shape (no notificationType) — the other router owns those', async () => {
    await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(
        makeResponse('resp-push', 'DONE', {
          schemaVersion: 1,
          eventType: 'family_task.assignment_requested.v1',
          familyId: '11111111-1111-4111-8111-111111111111',
          taskId: '22222222-2222-4222-8222-222222222222',
        }),
      );
    });

    expect(mockCompleteOccurrence).not.toHaveBeenCalled();
  });

  it('deduplicates: the same response+action never triggers the mutation twice', async () => {
    await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
    const listener = latestListener();

    const response = makeResponse('resp-dup', 'DONE', REMINDER_DATA);
    await act(async () => {
      listener(response);
    });
    await waitFor(() => expect(mockCompleteOccurrence).toHaveBeenCalledTimes(1));

    await act(async () => {
      listener(response);
    });

    expect(mockCompleteOccurrence).toHaveBeenCalledTimes(1);
  });

  it('a signed-out DONE/Snooze action never mutates — stores a pending route instead', async () => {
    await renderHook(() => useReminderNotificationActions(false), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(makeResponse('resp-signedout', 'DONE', REMINDER_DATA));
    });

    expect(mockCompleteOccurrence).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(useUIStore.getState().pendingNotificationRoute).toBe(
        '/task/22222222-2222-4222-8222-222222222222/edit',
      );
    });
  });

  it('a failed mutation (unauthorized/deleted occurrence) is caught, never left unhandled', async () => {
    mockCompleteOccurrence.mockRejectedValueOnce(new Error('no such occurrence'));
    await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await expect(
      act(async () => {
        latestListener()(makeResponse('resp-fail', 'DONE', REMINDER_DATA));
        await waitFor(() => expect(mockCompleteOccurrence).toHaveBeenCalledTimes(1));
      }),
    ).resolves.not.toThrow();
  });

  it('removes the listener on unmount', async () => {
    const remove = jest.fn();
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation(() => ({ remove }));

    const { unmount } = await renderHook(() => useReminderNotificationActions(true), { wrapper });
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
    await unmount();

    expect(remove).toHaveBeenCalled();
  });
});
