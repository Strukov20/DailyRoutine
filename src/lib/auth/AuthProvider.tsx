import type { Session } from '@supabase/supabase-js';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';

import { mapProfileRow } from '@/domain/profile/mappers';
import type { Profile } from '@/domain/profile/types';
import { createLogger } from '@/lib/logger/logger';
import { clearPersistedQueryCache } from '@/lib/query/persistedQueryClient';
import { queryClient } from '@/lib/query/queryClient';
import { supabase } from '@/lib/supabase/client';
import { useUIStore } from '@/store/uiStore';

const logger = createLogger('auth-provider');

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  /** null while status is 'loading', while signed out, or if the profile fetch failed. */
  profile: Profile | null;
  /** Re-fetches the current user's profile row — call after updating it. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}

/**
 * Owns Supabase session state for the whole app: restores the session on
 * launch, subscribes to sign-in/out/refresh events, and fetches the
 * matching profile row. Route groups (app/(auth)/_layout.tsx,
 * app/(app)/_layout.tsx) read `status` from here via Stack.Protected guards
 * — see app/_layout.tsx — so no screen needs its own ad hoc auth check.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (error) {
      logger.warn('failed to load profile', { message: error.message });
      setProfile(null);
      return;
    }
    setProfile(mapProfileRow(data));
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session) {
      await loadProfile(session.user.id);
    }
  }, [loadProfile, session]);

  // Tracks the most recent real signed-in user id purely so the
  // SIGNED_OUT branch below knows *whose* persisted query cache to clear
  // — by the time that event fires, `session`/`profile` state has not
  // necessarily re-rendered yet, and the event itself carries no user id
  // of its own (nextSession is null on sign-out).
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setStatus(data.session ? 'signed-in' : 'signed-out');
      if (data.session) {
        lastUserIdRef.current = data.session.user.id;
        void loadProfile(data.session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      logger.info('auth state changed', { event });
      setSession(nextSession);
      setStatus(nextSession ? 'signed-in' : 'signed-out');
      if (nextSession) {
        lastUserIdRef.current = nextSession.user.id;
        void loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
        // Real sign-out (never a mere family switch, which keeps the same
        // profileId): drop this profile's persisted offline cache and the
        // in-memory query cache both, so nothing from this account is
        // still resolvable to whatever signs in next on this device
        // (Section 8: "cleared on logout," "no data from the previous
        // account flashes after account switch").
        if (event === 'SIGNED_OUT' && lastUserIdRef.current) {
          void clearPersistedQueryCache(lastUserIdRef.current);
          queryClient.clear();
          useUIStore.getState().resetForSignOut();
          lastUserIdRef.current = null;
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, profile, refreshProfile }),
    [status, session, profile, refreshProfile],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
