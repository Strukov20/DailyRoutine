import { onlineManager } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@/lib/auth/AuthProvider';

import { runOfflineQueueReplay } from './offlineQueueReplay';
import { useOfflineQueueStore } from './offlineQueueStore';

/**
 * Phase 9, Sections 9-12 — the offline mutation queue's own lifecycle
 * manager. Mounted once near the app root (see app/_layout.tsx), alongside
 * useRealtimeSync/useReminderReconciliation — never from a screen.
 *
 * Hydrates the signed-in profile's persisted queue once auth is ready,
 * replays it (Section 12 triggers: auth restoration, NetInfo online via
 * onlineManager, foreground return, and retryOfflineQueue for a manual
 * Retry tap), and clears it immediately on logout/account switch so the
 * next signed-in profile never sees a previous account's queued
 * operations.
 */
export function useOfflineQueueSync(): void {
  const { status, profile } = useAuth();
  const hydratedProfileIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (status === 'signed-in' && profile) {
      if (hydratedProfileIdRef.current === profile.id) return;
      hydratedProfileIdRef.current = profile.id;
      void useOfflineQueueStore
        .getState()
        .hydrate(profile.id)
        .then(() => runOfflineQueueReplay());
    } else if (status === 'signed-out') {
      hydratedProfileIdRef.current = null;
      void useOfflineQueueStore.getState().reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, profile?.id]);

  useEffect(() => {
    return onlineManager.subscribe((isOnline) => {
      if (isOnline) void runOfflineQueueReplay();
    });
  }, []);

  useEffect(() => {
    function handleAppStateChange(next: AppStateStatus) {
      if (next === 'active') void runOfflineQueueReplay();
    }
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);
}

/** The sync status UI's Retry action (Section 16) — re-attempts every 'pending' op right now, ignoring the failed ones. */
export function retryOfflineQueue(): void {
  void runOfflineQueueReplay();
}
