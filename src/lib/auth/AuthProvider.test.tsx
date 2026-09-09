import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { supabase } from '@/lib/supabase/client';
import { useUIStore } from '@/store/uiStore';

import { AuthProvider, useAuth } from './AuthProvider';

type AuthStateCallback = (event: string, session: unknown) => void;

let authStateCallback: AuthStateCallback = () => {};

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn((callback: AuthStateCallback) => {
        authStateCallback = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'user-1',
          display_name: 'Test User',
          avatar_url: null,
          preferred_language: 'en',
          preferred_color_scheme: 'system',
        },
        error: null,
      }),
    })),
  },
}));

// Explicit factory, not automock: the real module transitively imports
// @react-native-async-storage/async-storage, which has no native module
// under Jest (see docs/TEST_STRATEGY.md).
const mockClearPersistedQueryCache = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/query/persistedQueryClient', () => ({
  clearPersistedQueryCache: (...args: unknown[]) => mockClearPersistedQueryCache(...args),
}));

const mockQueryClientClear = jest.fn();
jest.mock('@/lib/query/queryClient', () => ({
  queryClient: { clear: (...args: unknown[]) => mockQueryClientClear(...args) },
}));

function StatusProbe() {
  const { status, profile } = useAuth();
  return <Text>{`status:${status}|profile:${profile?.displayName ?? 'none'}`}</Text>;
}

describe('AuthProvider', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('starts in the loading state before the session restores', async () => {
    (supabase.auth.getSession as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves

    await render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );

    expect(screen.getByText('status:loading|profile:none')).toBeOnTheScreen();
  });

  it('becomes signed-out once getSession resolves with no session', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });

    await render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('status:signed-out|profile:none')).toBeOnTheScreen();
    });
  });

  it('becomes signed-in and loads the profile once a session is restored (successful session routing)', async () => {
    const fakeSession = { user: { id: 'user-1', email: 'a@test.local' } };
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: fakeSession } });

    await render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('status:signed-in|profile:Test User')).toBeOnTheScreen();
    });
  });

  it('reacts to a later sign-out event from onAuthStateChange', async () => {
    const fakeSession = { user: { id: 'user-1', email: 'a@test.local' } };
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: fakeSession } });
    useUIStore.setState({
      activeFamilyId: 'family-1',
      pendingInviteToken: 'stale-token',
      pendingNotificationRoute: '/task/stale-task',
    });

    await render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('status:signed-in|profile:Test User')).toBeOnTheScreen();
    });

    await act(async () => {
      authStateCallback('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(screen.getByText('status:signed-out|profile:none')).toBeOnTheScreen();
    });

    expect(mockClearPersistedQueryCache).toHaveBeenCalledWith('user-1');
    expect(mockQueryClientClear).toHaveBeenCalledTimes(1);
    // Phase 10: a real sign-out must also clear profile-scoped Zustand
    // state — the next account signed in on this device must never see
    // this account's active family or a stale pending deep link.
    expect(useUIStore.getState().activeFamilyId).toBeNull();
    expect(useUIStore.getState().pendingInviteToken).toBeNull();
    expect(useUIStore.getState().pendingNotificationRoute).toBeNull();
  });

  it('never clears the persisted cache for a mere TOKEN_REFRESHED event (not a sign-out)', async () => {
    const fakeSession = { user: { id: 'user-1', email: 'a@test.local' } };
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: fakeSession } });

    await render(
      <AuthProvider>
        <StatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('status:signed-in|profile:Test User')).toBeOnTheScreen();
    });

    await act(async () => {
      authStateCallback('TOKEN_REFRESHED', fakeSession);
    });

    expect(mockClearPersistedQueryCache).not.toHaveBeenCalled();
    expect(mockQueryClientClear).not.toHaveBeenCalled();
  });
});
