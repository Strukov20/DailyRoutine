import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { createLogger } from '@/lib/logger/logger';
import { supabase } from '@/lib/supabase/client';

/**
 * Transport-layer wrapper around `expo-notifications`/`expo-device` and the
 * notification_tokens/notification_preferences RPCs and reads — the only
 * module that calls either. Mirrors src/lib/auth/authService.ts's pattern;
 * see docs/ARCHITECTURE.md, "Layering." Deliberately does not call
 * `supabase.auth.*` itself (that stays exclusive to authService.ts) — a
 * caller's own profile id, when a write needs it, is passed in by the hook
 * layer via `useAuth()`, not looked up here.
 */

const logger = createLogger('notification-service');

export type NotificationErrorCode =
  | 'unsupported' // not a physical device — Expo cannot issue a real push token on a simulator/emulator
  | 'permission_denied'
  | 'missing_project_id' // no EAS project configured yet (Constants.expoConfig?.extra?.eas?.projectId absent)
  | 'registration_failed'
  | 'unknown';

export class NotificationServiceError extends Error {
  readonly code: NotificationErrorCode;

  constructor(code: NotificationErrorCode, message: string) {
    super(message);
    this.name = 'NotificationServiceError';
    this.code = code;
  }
}

function toNotificationServiceError(error: unknown): NotificationServiceError {
  const sqlState = (error as { code?: string } | null | undefined)?.code;
  const message = error instanceof Error ? error.message : 'Unknown notification error';
  logger.warn('notification request failed', { sqlState, message });
  return new NotificationServiceError('unknown', message);
}

// expo-notifications requires a handler to be set before any listener does
// anything useful — this is the foreground presentation policy (a banner,
// no custom sound/badge this phase). Setting it at module load time (not
// inside a component) is expo-notifications' own documented pattern.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const ANDROID_CHANNEL_ID = 'default';

async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export type NotificationPermissionStatus = Notifications.PermissionStatus;

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/** Must only be called from a deliberate, contextual action (a Settings screen) — never on app launch. */
export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status;
}

export function openSystemNotificationSettings(): Promise<void> {
  return Linking_openSettings();
}

// Isolated for testability — Linking.openSettings() has no return value to
// assert on, so tests mock this module boundary instead.
async function Linking_openSettings(): Promise<void> {
  const { Linking } = await import('react-native');
  await Linking.openSettings();
}

function getExpoProjectId(): string | null {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    null
  );
}

/**
 * Full registration flow: physical-device check -> projectId check ->
 * permission request -> Android channel -> obtain the Expo push token ->
 * upsert it via register_notification_token (see that RPC's own comment
 * for why it's a dedicated RPC, not a plain client upsert). Every failure
 * mode throws a typed NotificationServiceError instead of letting a raw
 * expo-notifications/network error surface — the caller (the Settings
 * screen) maps `.code` to translated, actionable copy.
 */
export async function registerForPushNotifications(): Promise<void> {
  if (!Device.isDevice) {
    throw new NotificationServiceError(
      'unsupported',
      'Push notifications require a physical device (simulator/emulator cannot receive a real Expo push token)',
    );
  }

  const projectId = getExpoProjectId();
  if (!projectId) {
    throw new NotificationServiceError(
      'missing_project_id',
      'No Expo projectId configured (Constants.expoConfig.extra.eas.projectId) — this project is not yet linked to EAS',
    );
  }

  const status = await requestNotificationPermission();
  if (status !== 'granted') {
    throw new NotificationServiceError('permission_denied', `Notification permission was ${status}`);
  }

  await ensureAndroidNotificationChannel();

  let expoPushToken: string;
  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    expoPushToken = tokenResponse.data;
  } catch (error) {
    logger.warn('failed to obtain an Expo push token', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new NotificationServiceError('registration_failed', 'Could not obtain an Expo push token');
  }

  const { error } = await supabase.rpc('register_notification_token', {
    p_expo_push_token: expoPushToken,
    p_device_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error) throw toNotificationServiceError(error);
}

/**
 * Best-effort — called right before sign-out (see app/(app)/profile.tsx).
 * Never throws: a failure here must never block signing out. Silently
 * no-ops on a simulator/emulator or a project with no EAS projectId, same
 * as registration would.
 */
export async function deactivateCurrentDeviceToken(): Promise<void> {
  if (!Device.isDevice) return;
  const projectId = getExpoProjectId();
  if (!projectId) return;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus !== 'granted') return;

    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase
      .from('notification_tokens')
      .update({ deactivated_at: new Date().toISOString() })
      .eq('expo_push_token', expoPushToken);
    if (error) {
      logger.warn('failed to deactivate the device token on logout', { message: error.message });
    }
  } catch (error) {
    logger.warn('failed to deactivate the device token on logout', {
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}

/**
 * RLS already scopes this to the caller (`profile_id = auth.uid()`) — no
 * profile id needed for a read. A missing row means "default enabled",
 * mirroring notification_preference_enabled()'s own server-side default.
 */
export async function getNotificationPreference(): Promise<boolean> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('assignment_notifications_enabled')
    .maybeSingle();
  if (error) throw toNotificationServiceError(error);
  return data?.assignment_notifications_enabled ?? true;
}

/**
 * Upserting requires `profile_id` as an explicit column value (RLS's own
 * `WITH CHECK (profile_id = auth.uid())` validates it, it does not fill
 * it in) — the caller's own id, from `useAuth()` via the hook layer, not
 * looked up here. See this module's own header comment.
 */
export async function setNotificationPreference(profileId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ profile_id: profileId, assignment_notifications_enabled: enabled }, { onConflict: 'profile_id' });
  if (error) throw toNotificationServiceError(error);
}

/**
 * "Show task titles in notifications" (Phase 8, Section 10) — a missing
 * row means the column's own server-side default, false: a lock-screen
 * reminder never shows a task's title/description until the caller
 * explicitly opts in. See src/lib/reminders/reminderReconciliation.ts,
 * the only place this preference is actually consumed.
 */
export async function getReminderTitlesPreference(): Promise<boolean> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('reminder_titles_enabled')
    .maybeSingle();
  if (error) throw toNotificationServiceError(error);
  return data?.reminder_titles_enabled ?? false;
}

export async function setReminderTitlesPreference(profileId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ profile_id: profileId, reminder_titles_enabled: enabled }, { onConflict: 'profile_id' });
  if (error) throw toNotificationServiceError(error);
}
