import { fireEvent, render, screen } from '@testing-library/react-native';

import type { FamilyMember } from '@/domain/family/types';
import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

// The screen under test lives in app/(app)/calendar.tsx, not under src/ —
// its test file must NOT live inside app/ too: Expo Router's Metro bundler
// treats every file under app/ as a route candidate regardless of name,
// and a .test.tsx there pulls @testing-library/react-native into the real
// production bundle (confirmed: `npx expo export --platform ios` fails
// outright with an unresolvable `console` import from inside the testing
// library once a test file sits under app/). Every other screen in this
// codebase is untested for the same underlying reason; this file is
// deliberately outside app/ instead of establishing that pattern.
// eslint-disable-next-line import/no-relative-parent-imports
import CalendarScreen from '../../../app/(app)/calendar';

initI18n();

// Phase 9 — the screen now also renders SyncStatusIndicator, which pulls
// in the offline queue store and therefore AsyncStorage; same convention
// as persistedQueryClient.test.ts.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'me-profile' } }),
}));

// @react-native-community/netinfo's real native module doesn't initialize
// under this project's react-test-renderer environment (no other screen
// test exercises OfflineBanner/useIsOffline yet) — mocked at the same
// module boundary useIsOffline itself uses, always reporting "online" so
// OfflineBanner renders nothing.
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: true }),
}));

const MEMBERS: FamilyMember[] = [
  {
    id: 'member-me',
    familyId: 'f1',
    profileId: 'me-profile',
    displayName: 'Alex',
    role: 'adult',
    memberType: 'adult',
    avatarUrl: null,
    dateOfBirth: null,
    removedAt: null,
  },
  {
    id: 'member-other',
    familyId: 'f1',
    profileId: 'other-profile',
    displayName: 'Jamie',
    role: 'adult',
    memberType: 'adult',
    avatarUrl: null,
    dateOfBirth: null,
    removedAt: null,
  },
];

jest.mock('@/domain/family/hooks', () => ({
  useActiveFamily: () => ({ activeFamily: { id: 'f1', name: 'Test Family' } }),
  useFamilyMembers: () => ({ data: MEMBERS }),
}));

// Phase 9 — the screen now also sources its Conflict Center entry-point
// badge from this hook; a static empty result keeps this file focused on
// the calendar behavior it actually tests (see ConflictsScreen.test.tsx
// for Conflict-Center-specific coverage).
jest.mock('@/domain/conflicts/hooks', () => ({
  useFamilyConflicts: () => ({ data: [], isLoading: false, isError: false, isFetching: false, refetch: jest.fn() }),
}));

const mockOwnEventsState = {
  data: [] as unknown[],
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: jest.fn(),
};
const mockFamilyScheduleState = {
  data: [] as unknown[],
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: jest.fn(),
};
const mockFamilyResponsibilitiesState = {
  data: [] as unknown[],
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: jest.fn(),
};
const mockConflictState = { data: false };

const mockTakeMutate = jest.fn();
const mockAcceptMutate = jest.fn();
const mockDeclineMutate = jest.fn();

jest.mock('@/domain/calendar/hooks', () => ({
  useOwnDayEvents: () => mockOwnEventsState,
  useFamilyDaySchedule: (familyId: string | null) => (familyId ? mockFamilyScheduleState : { ...mockFamilyScheduleState, data: [] }),
  useFamilyDayResponsibilities: (familyId: string | null) =>
    familyId ? mockFamilyResponsibilitiesState : { ...mockFamilyResponsibilitiesState, data: [] },
  useScheduleConflict: () => mockConflictState,
  useTakeEventResponsibility: () => ({ mutate: mockTakeMutate, isPending: false }),
  useAcceptEventResponsibility: () => ({ mutate: mockAcceptMutate, isPending: false }),
  useDeclineEventResponsibility: () => ({ mutate: mockDeclineMutate, isPending: false }),
}));

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

function resetState() {
  mockOwnEventsState.data = [];
  mockOwnEventsState.isLoading = false;
  mockOwnEventsState.isError = false;
  mockOwnEventsState.isFetching = false;
  mockFamilyScheduleState.data = [];
  mockFamilyScheduleState.isLoading = false;
  mockFamilyScheduleState.isError = false;
  mockFamilyScheduleState.isFetching = false;
  mockFamilyResponsibilitiesState.data = [];
  mockFamilyResponsibilitiesState.isLoading = false;
  mockFamilyResponsibilitiesState.isError = false;
  mockFamilyResponsibilitiesState.isFetching = false;
  mockConflictState.data = false;
}

afterEach(() => {
  jest.clearAllMocks();
  resetState();
});

describe('CalendarScreen', () => {
  it('renders own events chronologically in Personal mode', async () => {
    mockOwnEventsState.data = [
      { id: 'e1', title: 'Dentist', startsAt: '2026-09-10T14:00:00.000Z', endsAt: '2026-09-10T15:00:00.000Z' },
      { id: 'e2', title: 'Gym', startsAt: '2026-09-10T18:00:00.000Z', endsAt: '2026-09-10T19:00:00.000Z' },
    ];
    await renderWithTheme(<CalendarScreen />);

    const titles = screen.getAllByText(/Dentist|Gym/);
    expect(titles[0]).toHaveTextContent('Dentist');
    expect(titles[1]).toHaveTextContent('Gym');
  });

  it('shows the empty state when there is no content and nothing is loading', async () => {
    await renderWithTheme(<CalendarScreen />);

    expect(screen.getByText('Nothing scheduled')).toBeOnTheScreen();
  });

  it('shows a loading state instead of the list while fetching', async () => {
    mockOwnEventsState.isLoading = true;
    await renderWithTheme(<CalendarScreen />);

    expect(screen.queryByText('Nothing scheduled')).not.toBeOnTheScreen();
  });

  it('shows an error state on query failure', async () => {
    mockOwnEventsState.isError = true;
    await renderWithTheme(<CalendarScreen />);

    expect(screen.getByText('Something went wrong.')).toBeOnTheScreen();
  });

  it('switches to Family mode and renders the sanitized family schedule instead of own events', async () => {
    mockOwnEventsState.data = [
      { id: 'e1', title: 'Personal only', startsAt: '2026-09-10T14:00:00.000Z', endsAt: '2026-09-10T15:00:00.000Z' },
    ];
    mockFamilyScheduleState.data = [
      {
        id: 'fe1',
        ownerProfileId: 'other-profile',
        title: 'Family dinner',
        startsAt: '2026-09-10T18:00:00.000Z',
        endsAt: '2026-09-10T19:00:00.000Z',
        participantMemberId: null,
      },
    ];
    await renderWithTheme(<CalendarScreen />);

    await fireEvent.press(screen.getByText('Family'));

    expect(screen.getByText('Family dinner')).toBeOnTheScreen();
    expect(screen.queryByText('Personal only')).not.toBeOnTheScreen();
  });

  it('renders a private (Busy) family item without its title, and it is not pressable', async () => {
    mockFamilyScheduleState.data = [
      {
        id: 'fe1',
        ownerProfileId: 'other-profile',
        title: null,
        startsAt: '2026-09-10T18:00:00.000Z',
        endsAt: '2026-09-10T19:00:00.000Z',
        participantMemberId: null,
      },
    ];
    await renderWithTheme(<CalendarScreen />);
    await fireEvent.press(screen.getByText('Family'));

    const busyRow = screen.getByText('Busy');
    expect(busyRow).toBeOnTheScreen();

    await fireEvent.press(busyRow.parent as never);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates to the event detail screen when a non-busy family item is pressed', async () => {
    mockFamilyScheduleState.data = [
      {
        id: 'fe1',
        ownerProfileId: 'other-profile',
        title: 'Family dinner',
        startsAt: '2026-09-10T18:00:00.000Z',
        endsAt: '2026-09-10T19:00:00.000Z',
        participantMemberId: null,
      },
    ];
    await renderWithTheme(<CalendarScreen />);
    await fireEvent.press(screen.getByText('Family'));

    await fireEvent.press(screen.getByText('Family dinner'));

    expect(mockPush).toHaveBeenCalledWith('/event/fe1');
  });

  it('filters the family agenda down to Me', async () => {
    mockFamilyScheduleState.data = [
      {
        id: 'fe1',
        ownerProfileId: 'me-profile',
        title: 'My family event',
        startsAt: '2026-09-10T10:00:00.000Z',
        endsAt: '2026-09-10T11:00:00.000Z',
        participantMemberId: null,
      },
      {
        id: 'fe2',
        ownerProfileId: 'other-profile',
        title: "Jamie's event",
        startsAt: '2026-09-10T12:00:00.000Z',
        endsAt: '2026-09-10T13:00:00.000Z',
        participantMemberId: null,
      },
    ];
    await renderWithTheme(<CalendarScreen />);
    await fireEvent.press(screen.getByText('Family'));

    expect(screen.getByText('My family event')).toBeOnTheScreen();
    expect(screen.getByText("Jamie's event")).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Me'));

    expect(screen.getByText('My family event')).toBeOnTheScreen();
    expect(screen.queryByText("Jamie's event")).not.toBeOnTheScreen();
  });

  it('renders a family responsibility row and wires its Take action to the take mutation', async () => {
    mockFamilyResponsibilitiesState.data = [
      {
        id: 'r1',
        eventId: 'e1',
        familyId: 'f1',
        type: 'drop_off',
        label: null,
        assigneeMemberId: null,
        status: 'unassigned',
        eventStartsAt: '2026-09-10T17:00:00.000Z',
        eventEndsAt: '2026-09-10T18:00:00.000Z',
        eventTitle: 'Swimming',
        dueAt: '2026-09-10T17:00:00.000Z',
      },
    ];
    await renderWithTheme(<CalendarScreen />);
    await fireEvent.press(screen.getByText('Family'));

    await fireEvent.press(screen.getByText('Take'));

    expect(mockTakeMutate).toHaveBeenCalledWith('r1');
  });

  it('shows a conflict warning that names only the assignee, never a private event title', async () => {
    mockFamilyResponsibilitiesState.data = [
      {
        id: 'r1',
        eventId: 'e1',
        familyId: 'f1',
        type: 'pick_up',
        label: null,
        assigneeMemberId: 'member-other',
        status: 'accepted',
        eventStartsAt: '2026-09-10T17:00:00.000Z',
        eventEndsAt: '2026-09-10T18:00:00.000Z',
        eventTitle: 'Swimming',
        dueAt: '2026-09-10T18:00:00.000Z',
      },
    ];
    mockConflictState.data = true;
    await renderWithTheme(<CalendarScreen />);
    await fireEvent.press(screen.getByText('Family'));

    expect(screen.getByText('Jamie is busy at this time')).toBeOnTheScreen();
  });

  it('navigates to the plain new-event route from the FAB in Personal mode', async () => {
    await renderWithTheme(<CalendarScreen />);

    await fireEvent.press(screen.getByTestId('calendar-new-event-fab'));

    expect(mockPush).toHaveBeenCalledWith('/event/new');
  });

  it('navigates to the new-event route pre-scoped to the active family from the FAB in Family mode', async () => {
    await renderWithTheme(<CalendarScreen />);
    await fireEvent.press(screen.getByText('Family'));

    await fireEvent.press(screen.getByTestId('calendar-new-event-fab'));

    expect(mockPush).toHaveBeenCalledWith('/event/new?familyId=f1');
  });
});
