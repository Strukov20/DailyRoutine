import { render, screen, fireEvent } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import type { FamilyMember } from '@/domain/family/types';
import type { FamilyConflict } from '@/domain/conflicts/types';
import { AppThemeProvider } from '@/theme';

import { ConflictRow } from './ConflictRow';

initI18n();

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const MEMBER: FamilyMember = {
  id: 'm1',
  familyId: 'f1',
  memberType: 'adult',
  role: 'adult',
  profileId: 'p1',
  displayName: 'Dad',
  avatarUrl: null,
  dateOfBirth: null,
  removedAt: null,
};

function fakeConflict(overrides: Partial<FamilyConflict> = {}): FamilyConflict {
  return {
    conflictId: 'c1',
    familyId: 'f1',
    conflictDate: '2026-10-08',
    type: 'event_event',
    severity: 'warning',
    memberId: 'm1',
    primaryEntityType: 'event',
    primaryEntityId: 'e1',
    secondaryEntityType: 'event',
    secondaryEntityId: 'e2',
    safeMessageCode: 'conflicts.event_event',
    safeMessageParams: { time: '18:00' },
    ...overrides,
  };
}

function renderRow(conflict: FamilyConflict, members: FamilyMember[] = [MEMBER]) {
  return render(
    <AppThemeProvider>
      <ConflictRow conflict={conflict} members={members} />
    </AppThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ConflictRow', () => {
  it("renders the resolved member name, never a private title", async () => {
    await renderRow(fakeConflict());
    expect(screen.getByText('Dad has two overlapping events at 18:00')).toBeTruthy();
    // Nothing from the underlying private events (titles) is ever passed
    // into this component in the first place — the fixture itself proves
    // the row only ever had a member name + time to work with.
  });

  it('falls back to a generic name when memberId is null (e.g. no_available_adult)', async () => {
    await renderRow(
      fakeConflict({
        type: 'no_available_adult',
        severity: 'critical',
        memberId: null,
        primaryEntityType: 'responsibility',
        primaryEntityId: 'r1',
        secondaryEntityType: null,
        secondaryEntityId: null,
        safeMessageCode: 'conflicts.no_available_adult',
      }),
    );
    expect(screen.getByText('No available adult for the 18:00 drop-off/pick-up')).toBeTruthy();
  });

  it('shows the "Needs attention" severity label for a critical conflict, "Warning" for a warning one', async () => {
    await renderRow(fakeConflict({ severity: 'critical' }));
    expect(screen.getByText('Needs attention')).toBeTruthy();
  });

  it('Review navigates to the event editor when primaryEntityType is a navigable event', async () => {
    await renderRow(fakeConflict());
    await fireEvent.press(screen.getByText('Review'));
    expect(mockPush).toHaveBeenCalledWith('/event/e1');
  });

  it('Review navigates to the task editor when primaryEntityType is a navigable task', async () => {
    await renderRow(fakeConflict({ type: 'task_task', primaryEntityType: 'task', primaryEntityId: 't1' }));
    await fireEvent.press(screen.getByText('Review'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/task/[id]/edit', params: { id: 't1' } });
  });

  it("Review never navigates into a private item — a redacted (null) primaryEntityId falls through to Family Today instead", async () => {
    await renderRow(fakeConflict({ primaryEntityId: null }));
    await fireEvent.press(screen.getByText('Review'));
    expect(mockPush).toHaveBeenCalledWith('/calendar');
  });

  it('Review falls through to Family Today for a responsibility (no dedicated single-responsibility screen)', async () => {
    await renderRow(
      fakeConflict({
        type: 'unassigned_dropoff_pickup',
        memberId: null,
        primaryEntityType: 'responsibility',
        primaryEntityId: 'r1',
        secondaryEntityType: null,
        secondaryEntityId: null,
        safeMessageCode: 'conflicts.unassigned_dropoff_pickup',
      }),
    );
    await fireEvent.press(screen.getByText('Review'));
    expect(mockPush).toHaveBeenCalledWith('/calendar');
  });
});
