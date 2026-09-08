import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useMyFamilies } from '@/domain/family/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { createLogger } from '@/lib/logger/logger';
import { supabase } from '@/lib/supabase/client';
import { useUIStore } from '@/store/uiStore';

import { parseInvalidationPayload, queryKeyPrefixesForEntity } from './invalidationMap';

const logger = createLogger('realtime-sync');

/** Bursts of related broadcasts (one RPC touching several tables) collapse into one invalidation pass. */
const COALESCE_WINDOW_MS = 300;

/**
 * The single Realtime sync manager (Section 6) — mounted once, near the
 * app root (see app/_layout.tsx), never subscribed to from individual
 * screens. Subscribes to this profile's own `profile:<id>` topic plus a
 * `family:<id>` topic for every family the profile currently belongs to,
 * and on any generic invalidation message, refetches through the normal
 * TanStack Query + RLS path — never writes broadcast content into the
 * cache directly (Section 3: "A Realtime message is never authorization
 * and must never be written directly into the query cache as trusted
 * application data").
 *
 * Auth-token sync onto the Realtime client is already handled
 * automatically by the shared `supabase` client itself (supabase-js
 * listens for its own auth state changes and calls
 * `realtime.setAuth(token)` — confirmed by reading SupabaseClient's own
 * source, see docs/DECISIONS.md, "Phase 9") — this hook only owns channel
 * subscribe/unsubscribe lifecycle and message handling, never token
 * plumbing.
 */
export function useRealtimeSync(): void {
  const { status, profile } = useAuth();
  const queryClient = useQueryClient();
  const familiesQuery = useMyFamilies();
  const setRealtimeStatus = useUIStore((state) => state.setRealtimeStatus);

  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const pendingEntitiesRef = useRef<Set<string>>(new Set());
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushInvalidationsRef = useRef<() => void>(() => {});
  // Refs must never be written during render (react-hooks/refs) — this
  // keeps the closure's `queryClient` fresh after every render without
  // that, via an effect with no dependency array (runs after every
  // commit), rather than the write happening inline in the render body.
  useEffect(() => {
    flushInvalidationsRef.current = () => {
      const entities = Array.from(pendingEntitiesRef.current);
      pendingEntitiesRef.current.clear();
      coalesceTimerRef.current = null;

      const invalidatedPrefixes = new Set<string>();
      for (const entity of entities) {
        for (const prefix of queryKeyPrefixesForEntity(entity as Parameters<typeof queryKeyPrefixesForEntity>[0])) {
          const dedupeKey = JSON.stringify(prefix);
          if (invalidatedPrefixes.has(dedupeKey)) continue;
          invalidatedPrefixes.add(dedupeKey);
          // Active queries refetch immediately; inactive/persisted ones are
          // just marked stale and pick up the change on their next mount —
          // exactly TanStack's own default invalidateQueries behavior,
          // deliberately relied on rather than reimplemented (Section 7).
          void queryClient.invalidateQueries({ queryKey: prefix as unknown[] });
        }
      }
    };
  });

  function handleBroadcast(raw: unknown) {
    const payload = parseInvalidationPayload(raw);
    if (!payload) {
      logger.warn('ignoring a malformed or unrecognized realtime payload');
      return;
    }
    pendingEntitiesRef.current.add(payload.entity);
    if (coalesceTimerRef.current) return;
    coalesceTimerRef.current = setTimeout(() => flushInvalidationsRef.current(), COALESCE_WINDOW_MS);
  }

  function subscribeTopic(topic: string) {
    if (channelsRef.current.has(topic)) return; // never a duplicate subscription to the same topic
    const channel = supabase.channel(topic, { config: { private: true } });
    channel
      .on('broadcast', { event: 'invalidate' }, ({ payload }: { payload: unknown }) =>
        handleBroadcast(payload),
      )
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (subscribeStatus === 'CHANNEL_ERROR' || subscribeStatus === 'TIMED_OUT') {
          logger.warn('realtime channel subscription problem', { topic, subscribeStatus });
          setRealtimeStatus('error');
        }
      });
    channelsRef.current.set(topic, channel);
  }

  function unsubscribeTopic(topic: string) {
    const channel = channelsRef.current.get(topic);
    if (!channel) return;
    void supabase.removeChannel(channel);
    channelsRef.current.delete(topic);
  }

  function removeAllChannels() {
    for (const topic of Array.from(channelsRef.current.keys())) {
      unsubscribeTopic(topic);
    }
  }

  const familyIds = (familiesQuery.data ?? []).map((family) => family.id);
  // A plain array in a dependency list would re-run this effect on every
  // render (a new array identity each time) even when the ids are
  // unchanged — joined into one string so the effect only re-runs when
  // family *membership* actually changes (Section 6: "unsubscribe when
  // family membership changes," not on every unrelated re-render).
  const familyIdsKey = familyIds.slice().sort().join(',');

  useEffect(() => {
    if (status !== 'signed-in' || !profile) {
      removeAllChannels();
      setRealtimeStatus('offline');
      return;
    }

    if (useUIStore.getState().realtimeStatus !== 'connected') {
      setRealtimeStatus('connecting');
    }

    const desiredTopics = new Set<string>([`profile:${profile.id}`, ...familyIds.map((id) => `family:${id}`)]);

    for (const topic of Array.from(channelsRef.current.keys())) {
      if (!desiredTopics.has(topic)) unsubscribeTopic(topic);
    }
    for (const topic of desiredTopics) {
      subscribeTopic(topic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, profile?.id, familyIdsKey]);

  // Logout / account switch: remove every channel immediately, never
  // leave a subscription from the previous account outliving it.
  useEffect(() => {
    if (status === 'signed-out') {
      removeAllChannels();
      setRealtimeStatus('offline');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Foreground return: re-subscribe any topic whose channel silently died
  // while backgrounded, rather than waiting on a user-visible pull-to-refresh
  // to notice. Deliberately does not poll or run on any timer — bounded to
  // this one real lifecycle event (Section 6/12: no continuous loops).
  useEffect(() => {
    function handleAppStateChange(next: AppStateStatus) {
      if (next !== 'active') return;
      for (const [topic, channel] of channelsRef.current.entries()) {
        if (channel.state !== 'joined') {
          setRealtimeStatus('reconnecting');
          unsubscribeTopic(topic);
          subscribeTopic(topic);
        }
      }
    }
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmount: never leak a channel or a pending coalesce timer.
  useEffect(() => {
    return () => {
      removeAllChannels();
      if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
