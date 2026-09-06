/** Mirrors notification_tokens — see docs/DATA_MODEL.md. */
export interface NotificationToken {
  id: string;
  expoPushToken: string;
  devicePlatform: 'ios' | 'android';
  lastSeenAt: string;
  deactivatedAt: string | null;
}

/** The device's current standing with the OS + this backend, not just one flag. */
export type NotificationRegistrationState =
  | 'unknown'
  | 'unsupported' // not a physical device (simulator/emulator) — Expo cannot issue a real push token
  | 'denied'
  | 'not_registered' // permission granted, but no token registered yet (or registration failed)
  | 'registered';

export interface NotificationPreference {
  assignmentNotificationsEnabled: boolean;
}
