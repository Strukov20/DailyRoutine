import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useNotificationPermissionStatus, useReminderTitlesPreference } from '@/domain/notifications/hooks';
import { usePendingReminders, useScheduledOccurrencesForReminders } from '@/domain/recurrence/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { createLogger } from '@/lib/logger/logger';

import { ensureReminderNotificationCategory, expoLocalScheduler } from './localNotificationScheduler';
import { cancelAllRemindersForProfile, reconcileReminders } from './reminderReconciliation';

const logger = createLogger('reminder-reconciliation');

/**
 * Wires the production reconciliation algorithm (reminderReconciliation.ts)
 * into the app's real lifecycle (Section 12) — mount once near the app
 * root (see app/_layout.tsx), alongside useNotificationResponseRouter.
 *
 * Triggers covered:
 *   - after authenticated app initialization: the effect below runs as
 *     soon as the reminders/occurrences queries first resolve.
 *   - after create/update/delete, completion/restoration, snooze: those
 *     mutations already invalidate the same query keys this hook reads
 *     (see src/domain/recurrence/hooks.ts) — a normal TanStack Query
 *     refetch re-runs this effect.
 *   - after permission becomes granted: `permissionStatus` is a dependency.
 *   - app returns to foreground: an AppState listener refetches both
 *     queries, which re-runs this effect once fresh data lands.
 *   - account changes / logout: a ref tracks the last reconciled
 *     profileId; when auth transitions to signed-out (or a different
 *     profile), every one of *that* profile's own scheduled reminders is
 *     cancelled (never another profile's — see cancelAllRemindersForProfile).
 *   - device timezone change: not separately detected (no reliable
 *     cross-platform "timezone changed" event without a native module this
 *     phase doesn't add) — the next reconciliation triggered by any of the
 *     points above recomputes fire times using the device's *current*
 *     timezone regardless, so a stale schedule self-corrects on the next
 *     trigger rather than needing a dedicated listener. Documented as a
 *     known limitation, not a silent gap — see docs/DECISIONS.md, "Phase 8."
 *
 * Deliberately does NOT run continuously/on a timer — every trigger above
 * is a real, bounded lifecycle event, matching Section 12's "do not
 * trigger continuous reconciliation loops."
 */
export function useReminderReconciliation(): void {
  const { profile, status } = useAuth();
  const profileId = profile?.id ?? null;
  const isSignedIn = status === 'signed-in';

  const permissionQuery = useNotificationPermissionStatus();
  const remindersQuery = usePendingReminders();
  const occurrencesQuery = useScheduledOccurrencesForReminders();
  const titlesPreferenceQuery = useReminderTitlesPreference();

  const lastCleanedProfileRef = useRef<string | null>(null);

  useEffect(() => {
    void ensureReminderNotificationCategory();
  }, []);

  // Logout / account-switch cleanup — cancel only the profile that just
  // signed out or was replaced, never the newly signed-in one's (which
  // will get its own reconciliation pass below once its queries resolve).
  useEffect(() => {
    if (isSignedIn && profileId) return;
    const staleProfileId = lastCleanedProfileRef.current;
    if (!staleProfileId) return;
    lastCleanedProfileRef.current = null;
    void cancelAllRemindersForProfile(staleProfileId, expoLocalScheduler).catch((error: unknown) => {
      logger.warn('failed to cancel reminders on logout', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    });
  }, [isSignedIn, profileId]);

  useEffect(() => {
    if (!isSignedIn || !profileId) return;
    if (permissionQuery.data !== 'granted') return;
    if (!remindersQuery.data || !occurrencesQuery.data || titlesPreferenceQuery.data === undefined) return;

    lastCleanedProfileRef.current = profileId;

    reconcileReminders({
      profileId,
      reminders: remindersQuery.data,
      occurrences: occurrencesQuery.data,
      showTitles: titlesPreferenceQuery.data,
      scheduler: expoLocalScheduler,
    }).catch((error: unknown) => {
      logger.warn('reminder reconciliation failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    });
  }, [
    isSignedIn,
    profileId,
    permissionQuery.data,
    remindersQuery.data,
    occurrencesQuery.data,
    titlesPreferenceQuery.data,
  ]);

  // Foreground return — refetch so the effect above re-runs with fresh data.
  useEffect(() => {
    function handleAppStateChange(nextState: AppStateStatus) {
      if (nextState !== 'active') return;
      void remindersQuery.refetch();
      void occurrencesQuery.refetch();
    }
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
