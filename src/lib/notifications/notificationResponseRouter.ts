import { router, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';

import { parseNotificationPayload } from '@/domain/notifications/payload';
import { createLogger } from '@/lib/logger/logger';
import { useUIStore } from '@/store/uiStore';

const logger = createLogger('notification-response-router');

/**
 * Resolves a tapped notification's data payload to an in-app route.
 * Reuses the existing task editor route (app/task/[id]/edit.tsx), which
 * already handles "no longer authorized/deleted task" as a friendly
 * ErrorState (useTask()'s query naturally returns no row once RLS or a
 * soft-delete excludes it — see that screen) — no new route was needed.
 * The push payload is never trusted as task content or as authorization;
 * this only ever produces a route to *navigate to*, which then refetches
 * for real through the authenticated Supabase client + RLS. A malformed
 * or unrecognized-version payload resolves to null, never throws.
 */
export function resolveNotificationRoute(data: unknown): string | null {
  const payload = parseNotificationPayload(data);
  if (!payload) return null;
  return `/task/${payload.taskId}/edit`;
}

/**
 * Sets up the two required listeners (see docs.expo.dev, notification
 * response handling) with correct cleanup, covering all three required
 * cases:
 *   - cold start: getLastNotificationResponseAsync() on mount;
 *   - background -> foreground tap: addNotificationResponseReceivedListener;
 *   - already-foreground tap: the same listener fires for that case too.
 * Deduplicates by the notification request's own identifier — Expo can
 * redeliver the same cold-start response across a remount, and without
 * this a single real tap could otherwise navigate twice.
 */
export function useNotificationResponseRouter(isSignedIn: boolean): void {
  const handledIdsRef = useRef<Set<string>>(new Set());
  const setPendingNotificationRoute = useUIStore((state) => state.setPendingNotificationRoute);

  useEffect(() => {
    function handleResponse(response: Notifications.NotificationResponse) {
      const id = response.notification.request.identifier;
      if (handledIdsRef.current.has(id)) return;
      handledIdsRef.current.add(id);

      const route = resolveNotificationRoute(response.notification.request.content.data);
      if (!route) {
        logger.warn('ignored a notification response with an unrecognized/malformed payload');
        return;
      }

      if (isSignedIn) {
        // route is computed at runtime from a parsed push payload, not a
        // literal expo-router can statically match against its generated
        // route union — the same reason app/_layout.tsx's own
        // pendingNotificationRoute effect needs this cast too.
        router.push(route as Href);
      } else {
        // Preserve the target — app/_layout.tsx's redirect effect resolves
        // it once sign-in completes, same pattern as pendingInviteToken.
        setPendingNotificationRoute(route);
      }
    }

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleResponse(response);
      })
      .catch((error: unknown) => {
        logger.warn('failed to read the cold-start notification response', {
          message: error instanceof Error ? error.message : 'unknown',
        });
      });

    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => subscription.remove();
    // isSignedIn is intentionally in the dependency array (not captured
    // once) so a tap arriving right as auth state flips is routed
    // correctly either way, re-subscribing with the current value.
  }, [isSignedIn, setPendingNotificationRoute]);
}
