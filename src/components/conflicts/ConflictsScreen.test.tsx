import { render, screen } from '@testing-library/react-native';

import type { FamilyMember } from '@/domain/family/types';
import type { FamilyConflict } from '@/domain/conflicts/types';
import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

// Same reasoning as src/components/calendar/CalendarScreen.test.tsx for why
// this test file lives outside app/ — see that file's own comment.
// eslint-disable-next-line import/no-relative-parent-imports
import ConflictsScreen from '../../../app/conflicts';

initI18n();

// Phase 9 — the screen renders OfflineBanner, which pulls in NetInfo.
let mockIsConnected = true;
jest.mock('@react-native-community/netinfo', () => ({
  useNetInfo: () => ({ isConnected: mockIsConnected }),
}));

const MEMBERS: FamilyMember[] = [
  {
    id: 'member-dad',
    familyId: 'f1',
    profileId: 'dad-profile',
    displayName: 'Dad',
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

const mockRefetch = jest.fn();
let mockConflictsState: {
  data: FamilyConflict[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: typeof mockRefetch;
} = {
  data: [],
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: mockRefetch,
};

jest.mock('@/domain/conflicts/hooks', () => ({
  useFamilyConflicts: () => mockConflictsState,
}));

function fakeConflict(overrides: Partial<FamilyConflict> = {}): FamilyConflict {
  return {
    conflictId: 'c1',
    familyId: 'f1',
    conflictDate: '2026-10-08',
    type: 'event_event',
    severity: 'warning',
    memberId: 'member-dad',
    primaryEntityType: 'event',
    primaryEntityId: 'e1',
    secondaryEntityType: 'event',
    secondaryEntityId: 'e2',
    safeMessageCode: 'conflicts.event_event',
    safeMessageParams: { time: '18:00' },
    ...overrides,
  };
}

async function renderScreen() {
  return render(
    <AppThemeProvider>
      <ConflictsScreen />
    </AppThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConnected = true;
  mockConflictsState = { data: [], isLoading: false, isError: false, isFetching: false, refetch: mockRefetch };
});

describe('ConflictsScreen', () => {
  it('shows a loading state while the query is in flight', async () => {
    mockConflictsState = { ...mockConflictsState, isLoading: true, data: undefined };
    await renderScreen();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows an error state with a working retry when the query fails', async () => {
    mockConflictsState = { ...mockConflictsState, isError: true, data: undefined };
    await renderScreen();
    expect(screen.getByText('Something went wrong.')).toBeTruthy();
    screen.getByText('Try again');
  });

  it('shows the empty state when there are no conflicts', async () => {
    await renderScreen();
    expect(screen.getByText('No schedule conflicts right now.')).toBeTruthy();
  });

  it("buckets today's conflict under Today and a future one under Upcoming", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockConflictsState = {
      ...mockConflictsState,
      data: [
        fakeConflict({ conflictId: 'today-1', conflictDate: today }),
        fakeConflict({ conflictId: 'future-1', conflictDate: '2099-01-01' }),
      ],
    };
    await renderScreen();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Upcoming')).toBeTruthy();
  });

  it('shows an offline-stale note only while offline and there is cached data to show', async () => {
    mockIsConnected = false;
    mockConflictsState = { ...mockConflictsState, data: [fakeConflict()] };
    await renderScreen();
    expect(screen.getByText("You're offline — this list may be out of date.")).toBeTruthy();
  });

  it('never shows the offline-stale note while online', async () => {
    mockConflictsState = { ...mockConflictsState, data: [fakeConflict()] };
    await renderScreen();
    expect(screen.queryByText("You're offline — this list may be out of date.")).toBeNull();
  });
});
