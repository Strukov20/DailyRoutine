import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

import { useUIStore } from '@/store/uiStore';

import { useRealtimeSync } from './useRealtimeSync';

// Captures the hook's own AppState 'change' listener so tests can invoke
// it directly — react-native's real AppState is NativeEventEmitter-backed
// with no public way to synthesize a real OS foreground event under Jest.
type AppStateChangeCallback = (state: string) => void;
let appStateCallback: AppStateChangeCallback | null = null;

// Explicit factories throughout, not automocks — the real modules
// transitively import @/lib/supabase/client -> AsyncStorage, which has no
// native module under Jest (see docs/TEST_STRATEGY.md).

let mockAuthStatus: 'loading' | 'signed-out' | 'signed-in' = 'signed-in';
let mockProfile: { id: string } | null = { id: 'profile-1' };
jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ status: mockAuthStatus, profile: mockProfile }),
}));

let mockFamilies: { id: string }[] = [{ id: 'family-1' }];
jest.mock('@/domain/family/hooks', () => ({
  useMyFamilies: () => ({ data: mockFamilies }),
}));

interface FakeChannel {
  topic: string;
  state: string;
  on: jest.Mock;
  subscribe: jest.Mock;
  emit: (payload: unknown) => void;
}

let channels: FakeChannel[] = [];

function makeFakeChannel(topic: string, config: unknown): FakeChannel {
  let broadcastHandler: ((message: { payload: unknown }) => void) | null = null;
  const channel: FakeChannel = {
    topic,
    state: 'closed',
    on: jest.fn((_type: string, _filter: unknown, handler: (message: { payload: unknown }) => void) => {
      broadcastHandler = handler;
      return channel;
    }),
    subscribe: jest.fn((callback?: (status: string) => void) => {
      channel.state = 'joined';
      callback?.('SUBSCRIBED');
      return channel;
    }),
    emit: (payload: unknown) => broadcastHandler?.({ payload }),
  };
  void config;
  return channel;
}

const mockChannel = jest.fn((topic: string, config: unknown) => {
  const channel = makeFakeChannel(topic, config);
  channels.push(channel);
  return channel;
});
const mockRemoveChannel = jest.fn((channel: FakeChannel) => {
  channel.state = 'closed';
  channels = channels.filter((c) => c !== channel);
});

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    channel: (...args: [string, unknown]) => mockChannel(...args),
    removeChannel: (...args: [FakeChannel]) => mockRemoveChannel(...args),
  },
}));

function findChannel(topic: string): FakeChannel | undefined {
  return channels.find((c) => c.topic === topic);
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  channels = [];
  mockAuthStatus = 'signed-in';
  mockProfile = { id: 'profile-1' };
  mockFamilies = [{ id: 'family-1' }];
  useUIStore.setState({ realtimeStatus: 'offline' });
  appStateCallback = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    if (event === 'change') appStateCallback = callback as AppStateChangeCallback;
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useRealtimeSync', () => {
  it('subscribes to the own profile topic and every current family topic once auth is ready', async () => {
    await renderHook(() => useRealtimeSync(), { wrapper });

    expect(mockChannel).toHaveBeenCalledWith('profile:profile-1', { config: { private: true } });
    expect(mockChannel).toHaveBeenCalledWith('family:family-1', { config: { private: true } });
    expect(useUIStore.getState().realtimeStatus).toBe('connected');
  });

  it('never subscribes to anything while signed out', async () => {
    mockAuthStatus = 'signed-out';
    mockProfile = null;
    await renderHook(() => useRealtimeSync(), { wrapper });

    expect(mockChannel).not.toHaveBeenCalled();
    expect(useUIStore.getState().realtimeStatus).toBe('offline');
  });

  it('never creates a duplicate subscription to the same topic across re-renders', async () => {
    const { rerender } = await renderHook(() => useRealtimeSync(), { wrapper });
    const callCountAfterFirst = mockChannel.mock.calls.length;

    await rerender({});

    expect(mockChannel.mock.calls.length).toBe(callCountAfterFirst);
  });

  it('unsubscribes from a family topic once that family is no longer in the membership list (a real family switch)', async () => {
    const { rerender } = await renderHook(() => useRealtimeSync(), { wrapper });
    expect(findChannel('family:family-1')).toBeDefined();

    mockFamilies = [{ id: 'family-2' }];
    await rerender({});

    expect(findChannel('family:family-1')).toBeUndefined();
    expect(findChannel('family:family-2')).toBeDefined();
    expect(findChannel('profile:profile-1')).toBeDefined();
  });

  it('removes every channel on logout, leaving none open for the next account', async () => {
    const { rerender } = await renderHook(() => useRealtimeSync(), { wrapper });
    expect(channels.length).toBeGreaterThan(0);

    mockAuthStatus = 'signed-out';
    mockProfile = null;
    await rerender({});

    expect(channels.length).toBe(0);
    expect(useUIStore.getState().realtimeStatus).toBe('offline');
  });

  it('removes every channel on unmount (no listener/channel leak)', async () => {
    const { unmount } = await renderHook(() => useRealtimeSync(), { wrapper });
    expect(channels.length).toBeGreaterThan(0);

    await unmount();

    expect(channels.length).toBe(0);
  });

  it('ignores a malformed/unrecognized broadcast payload safely, without throwing', async () => {
    await renderHook(() => useRealtimeSync(), { wrapper });
    const channel = findChannel('profile:profile-1')!;

    expect(() => {
      channel.emit({ not: 'a valid payload' });
    }).not.toThrow();

    // act() is async in this RNTL version even for a sync callback — must
    // be awaited, or its dangling promise resolves mid-way through the
    // *next* test and corrupts its channel bookkeeping (a real bug found
    // via a full-suite-only failure that passed in isolation).
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
  });

  it('coalesces a burst of broadcasts within the debounce window into one invalidation pass', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    function localWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    await renderHook(() => useRealtimeSync(), { wrapper: localWrapper });
    const channel = findChannel('profile:profile-1')!;

    await act(async () => {
      channel.emit({ version: 1, scope: 'profile', entity: 'tasks', operation: 'changed' });
      channel.emit({ version: 1, scope: 'profile', entity: 'tasks', operation: 'changed' });
      channel.emit({ version: 1, scope: 'profile', entity: 'tasks', operation: 'changed' });
    });
    // Not yet flushed — still inside the coalesce window.
    expect(invalidateSpy).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    // One call per distinct query-key prefix, not one per broadcast.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['calendar'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['conflicts'] });
    expect(invalidateSpy.mock.calls.length).toBe(3);
  });

  it('maps a members broadcast to families/calendar/conflicts, per the documented invalidation map', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    function localWrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    await renderHook(() => useRealtimeSync(), { wrapper: localWrapper });
    const channel = findChannel('family:family-1')!;

    await act(async () => {
      channel.emit({ version: 1, scope: 'family', entity: 'members', operation: 'changed' });
      jest.advanceTimersByTime(500);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['families'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['calendar'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['conflicts'] });
  });

  it('re-subscribes a channel that is no longer joined when the app returns to the foreground', async () => {
    await renderHook(() => useRealtimeSync(), { wrapper });
    const channel = findChannel('profile:profile-1')!;
    channel.state = 'closed'; // simulates a socket that silently died while backgrounded

    await act(async () => {
      appStateCallback?.('active');
    });

    expect(mockRemoveChannel).toHaveBeenCalledWith(channel);
    expect(findChannel('profile:profile-1')).toBeDefined();
    expect(findChannel('profile:profile-1')).not.toBe(channel);
  });

  it('does nothing on foreground for a channel that is still joined', async () => {
    await renderHook(() => useRealtimeSync(), { wrapper });
    const channel = findChannel('profile:profile-1')!;
    const callsBefore = mockChannel.mock.calls.length;

    await act(async () => {
      appStateCallback?.('active');
    });

    expect(mockRemoveChannel).not.toHaveBeenCalled();
    expect(mockChannel.mock.calls.length).toBe(callsBefore);
    expect(findChannel('profile:profile-1')).toBe(channel);
  });
});
