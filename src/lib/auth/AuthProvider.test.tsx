import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { supabase } from '@/lib/supabase/client';

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
  });
});
