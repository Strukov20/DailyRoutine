import { QueryClient } from '@tanstack/react-query';

/**
 * Server-state cache for everything that ultimately comes from Supabase
 * (tasks, events, family data). Retries are conservative because most
 * failures during the foundation phase are "no backend configured yet",
 * not transient network blips — retrying those aggressively just delays
 * the error state the UI needs to show.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
