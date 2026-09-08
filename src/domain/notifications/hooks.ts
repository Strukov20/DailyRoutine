import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth/AuthProvider';
import {
  getNotificationPermissionStatus,
  getNotificationPreference,
  getReminderTitlesPreference,
  registerForPushNotifications,
  setNotificationPreference,
  setReminderTitlesPreference,
  type NotificationPermissionStatus,
} from '@/lib/notifications/notificationService';

/**
 * TanStack Query hooks for the notification settings screen — the only
 * layer that screen talks to (screen -> hooks -> notificationService, see
 * docs/ARCHITECTURE.md, "Layering"). Registration/permission state is
 * intentionally NOT cached with a long staleTime — it reflects live OS
 * state that can change outside this app (the user granting/revoking
 * permission from system Settings), so every mount re-checks it.
 */

export const notificationKeys = {
  permissionStatus: ['notifications', 'permission-status'] as const,
  preference: ['notifications', 'preference'] as const,
  reminderTitlesPreference: ['notifications', 'reminder-titles-preference'] as const,
};

export function useNotificationPermissionStatus() {
  return useQuery<NotificationPermissionStatus>({
    queryKey: notificationKeys.permissionStatus,
    queryFn: getNotificationPermissionStatus,
    staleTime: 0,
  });
}

export function useRegisterPushNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: registerForPushNotifications,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.permissionStatus });
    },
  });
}

export function useNotificationPreference() {
  return useQuery({
    queryKey: notificationKeys.preference,
    queryFn: getNotificationPreference,
  });
}

export function useSetNotificationPreference() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (enabled: boolean) => {
      if (!profile) {
        return Promise.reject(new Error('setNotificationPreference called with no signed-in profile'));
      }
      return setNotificationPreference(profile.id, enabled);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.preference });
    },
  });
}

/** "Show task titles in notifications" (Phase 8, Section 10) — defaults to disabled. */
export function useReminderTitlesPreference() {
  return useQuery({
    queryKey: notificationKeys.reminderTitlesPreference,
    queryFn: getReminderTitlesPreference,
  });
}

export function useSetReminderTitlesPreference() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: (enabled: boolean) => {
      if (!profile) {
        return Promise.reject(new Error('setReminderTitlesPreference called with no signed-in profile'));
      }
      return setReminderTitlesPreference(profile.id, enabled);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.reminderTitlesPreference });
    },
  });
}
