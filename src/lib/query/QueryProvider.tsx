import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { PropsWithChildren } from 'react';

import { useAuth } from '@/lib/auth/AuthProvider';

import { setUpQueryOnlineManager } from './onlineManager';
import { buildPersistOptions } from './persistedQueryClient';
import { queryClient } from './queryClient';

setUpQueryOnlineManager();

/**
 * Wraps the app in TanStack Query, adding the Phase 9 persistent offline
 * read cache (Section 8) on top of the plain in-memory `queryClient` that
 * already existed. Requires `useAuth()`, so this must render *inside*
 * `<AuthProvider>` (see app/_layout.tsx) — the reverse of this file's
 * pre-Phase-9 nesting, when QueryProvider had no reason to know about
 * auth state at all.
 *
 * `key={profileId}` on the persisted branch is what makes an account
 * switch safe: React tears down and rebuilds the entire
 * `PersistQueryClientProvider` subtree (a fresh persister instance, a
 * fresh restore cycle from that profile's own AsyncStorage key) rather
 * than reusing one internally reconfigured for a new profile, which is
 * what actually guarantees "no data from the previous account flashes"
 * (Section 8) — TanStack's own internal restore bookkeeping is keyed to
 * the provider instance's lifetime, not to the `persister` prop's
 * identity alone.
 *
 * While signed out (or before auth has resolved), no persister is
 * attached at all — nothing meaningful to persist for a session with no
 * profile, and it avoids ever writing to a storage key before a real
 * profileId exists to scope it to.
 */
export function QueryProvider({ children }: PropsWithChildren) {
  const { status, profile } = useAuth();

  if (status === 'signed-in' && profile) {
    return (
      <PersistQueryClientProvider
        key={profile.id}
        client={queryClient}
        persistOptions={buildPersistOptions(profile.id)}
      >
        {children}
      </PersistQueryClientProvider>
    );
  }

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
