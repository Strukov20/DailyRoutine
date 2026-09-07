import { act, renderHook, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { useUIStore } from '@/store/uiStore';

import { resolveNotificationRoute, useNotificationResponseRouter } from './notificationResponseRouter';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

function makeResponse(identifier: string, data: unknown) {
  return {
    notification: { request: { identifier, content: { data } } },
  } as unknown as Notifications.NotificationResponse;
}

/** Reads the listener actually passed to the most recent registration call — never a shared, order-dependent variable. */
function latestListener(): (response: Notifications.NotificationResponse) => void {
  const mock = Notifications.addNotificationResponseReceivedListener as jest.Mock;
  const calls = mock.mock.calls;
  const [cb] = calls[calls.length - 1] as [(response: Notifications.NotificationResponse) => void];
  return cb;
}

const validData = {
  schemaVersion: 1,
  eventType: 'family_task.assignment_requested.v1',
  familyId: '11111111-1111-4111-8111-111111111111',
  taskId: '22222222-2222-4222-8222-222222222222',
};

describe('resolveNotificationRoute', () => {
  it('resolves a valid payload to the task edit route', () => {
    expect(resolveNotificationRoute(validData)).toBe('/task/22222222-2222-4222-8222-222222222222/edit');
  });

  it('returns null for a malformed/unsupported payload', () => {
    expect(resolveNotificationRoute({ garbage: true })).toBeNull();
    expect(resolveNotificationRoute(null)).toBeNull();
  });
});

describe('useNotificationResponseRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUIStore.setState({ pendingNotificationRoute: null });
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(null);
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation(() => ({
      remove: jest.fn(),
    }));
  });

  it('navigates immediately when signed in and a tap arrives', async () => {
    await renderHook(() => useNotificationResponseRouter(true));
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(makeResponse('resp-1', validData));
    });

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/task/22222222-2222-4222-8222-222222222222/edit');
    });
  });

  it('stores a pending route instead of navigating when signed out', async () => {
    await renderHook(() => useNotificationResponseRouter(false));
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(makeResponse('resp-2', validData));
    });

    await waitFor(() => {
      expect(useUIStore.getState().pendingNotificationRoute).toBe(
        '/task/22222222-2222-4222-8222-222222222222/edit',
      );
    });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('ignores a malformed/unrecognized payload safely — no navigation, no throw', async () => {
    await renderHook(() => useNotificationResponseRouter(true));
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());

    await act(async () => {
      latestListener()(makeResponse('resp-3', { unexpected: 'shape' }));
    });

    expect(router.push).not.toHaveBeenCalled();
  });

  it('deduplicates: the same response identifier never navigates twice', async () => {
    await renderHook(() => useNotificationResponseRouter(true));
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
    const listener = latestListener();

    const response = makeResponse('resp-dup', validData);
    await act(async () => {
      listener(response);
    });
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));

    await act(async () => {
      listener(response);
    });

    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('resolves a cold-start response on mount', async () => {
    (Notifications.getLastNotificationResponseAsync as jest.Mock).mockResolvedValue(
      makeResponse('resp-cold-start', validData),
    );

    await renderHook(() => useNotificationResponseRouter(true));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/task/22222222-2222-4222-8222-222222222222/edit');
    });
  });

  it('removes the listener on unmount', async () => {
    const remove = jest.fn();
    (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation(() => ({ remove }));

    const { unmount } = await renderHook(() => useNotificationResponseRouter(true));
    await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
    await unmount();

    expect(remove).toHaveBeenCalled();
  });
});
