import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { initI18n } from '@/i18n';
import type { Family, FamilyMember } from '@/domain/family/types';
import { FamilyServiceError } from '@/lib/family/familyService';
import { AppThemeProvider } from '@/theme';

// Same reasoning as src/components/calendar/CalendarScreen.test.tsx for why
// this test file lives outside app/ — see that file's own comment.
import FamilyScreen from '../../../app/(app)/family';

initI18n();

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn() }),
}));

let mockCallerProfileId = 'owner-1';
jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: mockCallerProfileId },
    session: null,
    status: 'signed-in',
    refreshProfile: jest.fn(),
  }),
}));

jest.mock('@/components/tasks/FamilyTaskBoard', () => ({
  FamilyTaskBoard: () => null,
}));

const FAMILY: Family = { id: 'fam-1', name: 'Test Family', ownerId: 'owner-1', createdAt: '2026-01-01' };

function fakeMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'member-owner',
    familyId: 'fam-1',
    memberType: 'adult',
    role: 'owner',
    profileId: 'owner-1',
    displayName: 'Owner',
    avatarUrl: null,
    dateOfBirth: null,
    removedAt: null,
    ...overrides,
  };
}

let mockMembers: FamilyMember[] = [fakeMember()];
const mockLeaveMutateAsync = jest.fn();
const mockDeleteMutateAsync = jest.fn();
let mockLeavePending = false;
let mockDeletePending = false;

jest.mock('@/domain/family/hooks', () => ({
  useActiveFamily: () => ({ families: [FAMILY], activeFamily: FAMILY, isLoading: false, isError: false }),
  useFamilyMembers: () => ({ data: mockMembers }),
  useFamilyInvitations: () => ({ data: [] }),
  useLeaveFamily: () => ({ mutateAsync: (...args: unknown[]) => mockLeaveMutateAsync(...args), isPending: mockLeavePending }),
  useDeleteFamily: () => ({ mutateAsync: (...args: unknown[]) => mockDeleteMutateAsync(...args), isPending: mockDeletePending }),
}));

// react-native's Alert.alert never renders into the RNTL tree (it's a
// native modal) — the standard way to test it is to spy on Alert.alert
// itself, capture the buttons it was called with, and invoke the desired
// button's onPress directly.
const alertSpy = jest.spyOn(Alert, 'alert');

async function pressAlertButton(label: string) {
  const call = alertSpy.mock.calls.at(-1);
  const buttons = call?.[2];
  const button = buttons?.find((b) => b.text === label);
  if (!button?.onPress) throw new Error(`No Alert button found with label "${label}"`);
  await act(async () => {
    await button.onPress?.();
  });
}

async function renderScreen() {
  return render(
    <AppThemeProvider>
      <FamilyScreen />
    </AppThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLeavePending = false;
  mockDeletePending = false;
  mockMembers = [fakeMember()];
  mockCallerProfileId = 'owner-1';
});

describe('FamilyScreen — family settings danger zone', () => {
  it('shows "Delete family" (never "Leave family") for the current owner', async () => {
    await renderScreen();
    expect(screen.getByTestId('family-delete-button')).toBeTruthy();
    expect(screen.queryByTestId('family-leave-button')).toBeNull();
  });

  it('shows "Leave family" (never "Delete family") for a non-owner adult member', async () => {
    mockCallerProfileId = 'adult-2';
    mockMembers = [fakeMember(), fakeMember({ id: 'member-adult', role: 'adult', profileId: 'adult-2' })];
    await renderScreen();
    expect(screen.getByTestId('family-leave-button')).toBeTruthy();
    expect(screen.queryByTestId('family-delete-button')).toBeNull();
  });

  it('deleting the family requires confirmation, then calls deleteFamily with the active family id', async () => {
    mockDeleteMutateAsync.mockResolvedValue(undefined);
    await renderScreen();
    await fireEvent.press(screen.getByTestId('family-delete-button'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete this family?',
      expect.stringContaining('Every member will immediately lose access'),
      expect.anything(),
    );

    await pressAlertButton('Delete family');
    await waitFor(() => expect(mockDeleteMutateAsync).toHaveBeenCalledWith('fam-1'));
  });

  it('shows a Cancel option (no destructive action) alongside the confirm action, and never calls deleteFamily on its own', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('family-delete-button'));

    const buttons = alertSpy.mock.calls.at(-1)?.[2];
    const cancelButton = buttons?.find((b) => b.text === 'Cancel');
    expect(cancelButton).toBeDefined();
    expect(cancelButton?.style).toBe('cancel');
    expect(mockDeleteMutateAsync).not.toHaveBeenCalled();
  });

  it('shows a safe error message when deleteFamily fails', async () => {
    mockDeleteMutateAsync.mockRejectedValue(new FamilyServiceError('forbidden', 'nope'));
    await renderScreen();
    await fireEvent.press(screen.getByTestId('family-delete-button'));
    await pressAlertButton('Delete family');

    await waitFor(() => expect(screen.getByText("Couldn't delete the family. Please try again.")).toBeTruthy());
  });
});
