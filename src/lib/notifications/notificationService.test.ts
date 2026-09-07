import * as Notifications from 'expo-notifications';

import { supabase } from '@/lib/supabase/client';

import {
  deactivateCurrentDeviceToken,
  getNotificationPreference,
  NotificationServiceError,
  registerForPushNotifications,
  setNotificationPreference,
} from './notificationService';

// expo-notifications/expo-device/expo-constants and @/lib/supabase/client
// all get explicit factory mocks (not automock) — automocking would still
// evaluate the real modules once to infer their shape, and
// @/lib/supabase/client transitively imports @react-native-async-storage/
// async-storage, which fails outside a real native environment. See
// knowledge/wiki/engineering/testing-strategy.md for this established
// convention.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));
// A plain data property here would be copied once at each call site's own
// ESM-interop wrapping (Babel's _interopRequireWildcard snapshots a value
// descriptor), so mutating it from a test would never be visible to
// notificationService.ts's own `import * as Device`. A getter descriptor
// is preserved as a live accessor through that copy instead, so both
// files' namespace objects keep reading the same mutable box.
let mockIsDevice = true;
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice;
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'test-project-id' } } }, easConfig: null },
}));
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Linking: { openSettings: jest.fn() },
}));

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDevice = true;
  });

  describe('registerForPushNotifications', () => {
    it('throws unsupported on a simulator/emulator (missing projectId is not reached)', async () => {
      mockIsDevice = false;

      await expect(registerForPushNotifications()).rejects.toMatchObject({
        code: 'unsupported',
      });
      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('throws permission_denied when the user declines', async () => {
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

      await expect(registerForPushNotifications()).rejects.toMatchObject({
        code: 'permission_denied',
      });
      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it('throws registration_failed when getExpoPushTokenAsync throws', async () => {
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(new Error('boom'));

      await expect(registerForPushNotifications()).rejects.toMatchObject({
        code: 'registration_failed',
      });
    });

    it('registers the token via the RPC on success (token upsert/rotation path)', async () => {
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: 'ExponentPushToken[abc123]',
      });
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: 'token-row-id', error: null });

      await registerForPushNotifications();

      expect(supabase.rpc).toHaveBeenCalledWith('register_notification_token', {
        p_expo_push_token: 'ExponentPushToken[abc123]',
        p_device_platform: 'ios',
      });
    });

    it('throws a typed NotificationServiceError when the RPC itself fails', async () => {
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: 'ExponentPushToken[abc123]',
      });
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'db down' } });

      await expect(registerForPushNotifications()).rejects.toBeInstanceOf(NotificationServiceError);
    });
  });

  describe('deactivateCurrentDeviceToken', () => {
    it('is a safe no-op on a simulator/emulator', async () => {
      mockIsDevice = false;

      await deactivateCurrentDeviceToken();

      expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    });

    it('is a safe no-op when permission was never granted', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

      await deactivateCurrentDeviceToken();

      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });

    it("updates deactivated_at for this device's token (logout deactivation)", async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: 'ExponentPushToken[abc123]',
      });
      const eq = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn(() => ({ eq }));
      (supabase.from as jest.Mock).mockReturnValue({ update });

      await deactivateCurrentDeviceToken();

      expect(supabase.from).toHaveBeenCalledWith('notification_tokens');
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ deactivated_at: expect.any(String) }));
      expect(eq).toHaveBeenCalledWith('expo_push_token', 'ExponentPushToken[abc123]');
    });

    it('never throws even if the underlying call throws (logout must never be blocked by this)', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValue(new Error('boom'));

      await expect(deactivateCurrentDeviceToken()).resolves.toBeUndefined();
    });
  });

  describe('notification preference', () => {
    it('defaults to enabled when no preference row exists', async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      const select = jest.fn(() => ({ maybeSingle }));
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(getNotificationPreference()).resolves.toBe(true);
    });

    it('reflects a disabled preference row', async () => {
      const maybeSingle = jest
        .fn()
        .mockResolvedValue({ data: { assignment_notifications_enabled: false }, error: null });
      const select = jest.fn(() => ({ maybeSingle }));
      (supabase.from as jest.Mock).mockReturnValue({ select });

      await expect(getNotificationPreference()).resolves.toBe(false);
    });

    it("upserts on the caller's own profile id", async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null });
      (supabase.from as jest.Mock).mockReturnValue({ upsert });

      await setNotificationPreference('profile-123', false);

      expect(upsert).toHaveBeenCalledWith(
        { profile_id: 'profile-123', assignment_notifications_enabled: false },
        { onConflict: 'profile_id' },
      );
    });
  });
});
