import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import { ProfileServiceError } from '@/lib/profile/profileService';
import { AppThemeProvider } from '@/theme';

// Same reasoning as src/components/calendar/CalendarScreen.test.tsx for why
// this test file lives outside app/ — see that file's own comment.
import ProfileScreen from '../../../app/(app)/profile';

initI18n();

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'me-1', displayName: 'Test User' },
    session: { user: { email: 'test-user@example.com' } },
    status: 'signed-in',
    refreshProfile: jest.fn(),
  }),
}));

const mockSignOut = jest.fn();
jest.mock('@/lib/auth/authService', () => ({
  ...jest.requireActual('@/lib/auth/authService'),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

const mockDeactivateToken = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/notifications/notificationService', () => ({
  deactivateCurrentDeviceToken: (...args: unknown[]) => mockDeactivateToken(...args),
}));

const mockMutateAsync = jest.fn();
jest.mock('@/domain/profile/hooks', () => ({
  useRequestAccountDeletion: () => ({ mutateAsync: (...args: unknown[]) => mockMutateAsync(...args) }),
}));

async function renderScreen() {
  return render(
    <AppThemeProvider>
      <ProfileScreen />
    </AppThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignOut.mockResolvedValue(undefined);
});

describe('ProfileScreen — account deletion', () => {
  it('opens the confirmation dialog and keeps Delete disabled until the exact phrase is typed', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('profile-delete-account'));

    expect(screen.getByText('Delete your account?')).toBeTruthy();
    const confirmButton = screen.getByTestId('profile-delete-account-confirm');
    expect(confirmButton.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('profile-delete-account-confirm-input'), 'delete');
    expect(confirmButton.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByTestId('profile-delete-account-confirm-input'), 'DELETE');
    expect(confirmButton.props.accessibilityState.disabled).toBe(false);
  });

  it('on success, requests deletion, deactivates the device token, and signs out', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    await renderScreen();
    await fireEvent.press(screen.getByTestId('profile-delete-account'));
    await fireEvent.changeText(screen.getByTestId('profile-delete-account-confirm-input'), 'DELETE');
    await fireEvent.press(screen.getByTestId('profile-delete-account-confirm'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockDeactivateToken).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('shows a specific message and never signs out when the caller still owns a family', async () => {
    mockMutateAsync.mockRejectedValue(new ProfileServiceError('still_owns_a_family', 'nope'));
    await renderScreen();
    await fireEvent.press(screen.getByTestId('profile-delete-account'));
    await fireEvent.changeText(screen.getByTestId('profile-delete-account-confirm-input'), 'DELETE');
    await fireEvent.press(screen.getByTestId('profile-delete-account-confirm'));

    await waitFor(() =>
      expect(
        screen.getByText('You still own a family. Transfer ownership or delete it from Family settings before deleting your account.'),
      ).toBeTruthy(),
    );
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('shows a generic error for any other failure', async () => {
    mockMutateAsync.mockRejectedValue(new Error('boom'));
    await renderScreen();
    await fireEvent.press(screen.getByTestId('profile-delete-account'));
    await fireEvent.changeText(screen.getByTestId('profile-delete-account-confirm-input'), 'DELETE');
    await fireEvent.press(screen.getByTestId('profile-delete-account-confirm'));

    await waitFor(() => expect(screen.getByText("Couldn't delete your account. Please try again.")).toBeTruthy());
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('cancelling the dialog never calls the deletion RPC', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('profile-delete-account'));
    await fireEvent.changeText(screen.getByTestId('profile-delete-account-confirm-input'), 'DELETE');
    await fireEvent.press(screen.getByText('Cancel'));

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});
