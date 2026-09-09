import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { initI18n } from '@/i18n';
import type { FamilyMember } from '@/domain/family/types';
import { FamilyServiceError } from '@/lib/family/familyService';
import { AppThemeProvider } from '@/theme';

// Same reasoning as src/components/family/FamilyScreen.test.tsx for why this
// test file lives outside app/ — see that file's own comment.
import FamilyMemberDetailScreen from '../../../app/family/member/[id]';

initI18n();

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockRouterBack = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ back: mockRouterBack }),
  useLocalSearchParams: () => ({ id: mockMemberId, familyId: 'fam-1' }),
  // `<Stack.Screen>` needs a real navigator route context (`useRoute`) that
  // isn't present when rendering this screen standalone under RNTL — same
  // reasoning as EventEditorForm.test.tsx mocking useNavigation instead of
  // rendering the real navigator.
  Stack: { Screen: () => null },
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

const ADULT_MEMBER = fakeMember({
  id: 'member-adult',
  role: 'adult',
  profileId: 'adult-2',
  displayName: 'Adult Two',
});

let mockMemberId = ADULT_MEMBER.id;
let mockMembers: FamilyMember[] = [fakeMember(), ADULT_MEMBER];
const mockTransferMutateAsync = jest.fn();
const mockRemoveMutateAsync = jest.fn();
const mockUpdateChildMutateAsync = jest.fn();
let mockTransferPending = false;

jest.mock('@/domain/family/hooks', () => ({
  useFamilyMembers: () => ({ data: mockMembers, isLoading: false }),
  useRemoveFamilyMember: () => ({ mutateAsync: (...args: unknown[]) => mockRemoveMutateAsync(...args), isPending: false }),
  useUpdateChildProfile: () => ({ mutateAsync: (...args: unknown[]) => mockUpdateChildMutateAsync(...args), isPending: false }),
  useTransferFamilyOwnership: () => ({
    mutateAsync: (...args: unknown[]) => mockTransferMutateAsync(...args),
    isPending: mockTransferPending,
  }),
}));

// react-native's Alert.alert never renders into the RNTL tree (it's a
// native modal) — spy on it and invoke the desired button's onPress
// directly, same pattern as FamilyScreen.test.tsx.
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
      <FamilyMemberDetailScreen />
    </AppThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTransferPending = false;
  mockMemberId = ADULT_MEMBER.id;
  mockMembers = [fakeMember(), ADULT_MEMBER];
  mockCallerProfileId = 'owner-1';
});

describe('FamilyMemberDetailScreen — make family owner', () => {
  it('shows "Make family owner" for an adult member when the caller is the owner', async () => {
    await renderScreen();
    expect(screen.getByText('Make family owner')).toBeTruthy();
  });

  it('never shows "Make family owner" to a non-owner caller', async () => {
    mockCallerProfileId = 'adult-2';
    await renderScreen();
    expect(screen.queryByText('Make family owner')).toBeNull();
  });

  it('never shows "Make family owner" on the owner\'s own row', async () => {
    mockMemberId = 'member-owner';
    await renderScreen();
    expect(screen.queryByText('Make family owner')).toBeNull();
  });

  it('requires confirmation naming the target member, then calls transferFamilyOwnership with the member id', async () => {
    mockTransferMutateAsync.mockResolvedValue(undefined);
    await renderScreen();
    await fireEvent.press(screen.getByText('Make family owner'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Transfer ownership to Adult Two?',
      expect.stringContaining('You will become a regular adult member'),
      expect.anything(),
    );

    await pressAlertButton('Make family owner');
    expect(mockTransferMutateAsync).toHaveBeenCalledWith(ADULT_MEMBER.id);
    expect(mockRouterBack).toHaveBeenCalled();
  });

  it('shows a Cancel option and never transfers ownership on its own', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByText('Make family owner'));

    const buttons = alertSpy.mock.calls.at(-1)?.[2];
    const cancelButton = buttons?.find((b) => b.text === 'Cancel');
    expect(cancelButton).toBeDefined();
    expect(cancelButton?.style).toBe('cancel');
    expect(mockTransferMutateAsync).not.toHaveBeenCalled();
  });

  it('shows a safe error message and does not navigate back when the transfer fails', async () => {
    mockTransferMutateAsync.mockRejectedValue(new FamilyServiceError('forbidden', 'nope'));
    await renderScreen();
    await fireEvent.press(screen.getByText('Make family owner'));
    await pressAlertButton('Make family owner');

    await waitFor(() =>
      expect(screen.getByText("Couldn't transfer ownership. Please try again.")).toBeTruthy(),
    );
    expect(mockRouterBack).not.toHaveBeenCalled();
  });
});
