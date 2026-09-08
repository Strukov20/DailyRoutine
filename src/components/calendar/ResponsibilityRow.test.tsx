import { fireEvent, render, screen } from '@testing-library/react-native';

import type { FamilyMember } from '@/domain/family/types';
import type { FamilyResponsibilityItem } from '@/domain/calendar/types';
import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import { ResponsibilityRow } from './ResponsibilityRow';

initI18n();

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

const MEMBERS: FamilyMember[] = [
  {
    id: 'member-me',
    familyId: 'f1',
    profileId: 'me-profile',
    displayName: 'Me',
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

const RESPONSIBILITY: FamilyResponsibilityItem = {
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
};

const NOOP_HANDLERS = {
  onTake: jest.fn(),
  onAccept: jest.fn(),
  onDecline: jest.fn(),
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('ResponsibilityRow', () => {
  it('shows a Take button for an unassigned responsibility and calls onTake when pressed', async () => {
    const onTake = jest.fn();
    await renderWithTheme(
      <ResponsibilityRow
        responsibility={RESPONSIBILITY}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        isBusy={false}
        {...NOOP_HANDLERS}
        onTake={onTake}
      />,
    );

    await fireEvent.press(screen.getByText('Take'));

    expect(onTake).toHaveBeenCalledTimes(1);
  });

  it('shows Accept/Decline only to the pending recipient, not to another member', async () => {
    const pendingForMe: FamilyResponsibilityItem = {
      ...RESPONSIBILITY,
      assigneeMemberId: 'member-me',
      status: 'pending_acceptance',
    };
    await renderWithTheme(
      <ResponsibilityRow
        responsibility={pendingForMe}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByText('Accept')).toBeOnTheScreen();
    expect(screen.getByText('Decline')).toBeOnTheScreen();
  });

  it('does not show Accept/Decline to a member who is not the pending recipient', async () => {
    const pendingForOther: FamilyResponsibilityItem = {
      ...RESPONSIBILITY,
      assigneeMemberId: 'member-other',
      status: 'pending_acceptance',
    };
    await renderWithTheme(
      <ResponsibilityRow
        responsibility={pendingForOther}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.queryByText('Accept')).not.toBeOnTheScreen();
    expect(screen.queryByText('Decline')).not.toBeOnTheScreen();
  });

  it('calls onAccept and onDecline when their buttons are pressed', async () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    const pendingForMe: FamilyResponsibilityItem = {
      ...RESPONSIBILITY,
      assigneeMemberId: 'member-me',
      status: 'pending_acceptance',
    };
    await renderWithTheme(
      <ResponsibilityRow
        responsibility={pendingForMe}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        isBusy={false}
        {...NOOP_HANDLERS}
        onAccept={onAccept}
        onDecline={onDecline}
      />,
    );

    await fireEvent.press(screen.getByText('Accept'));
    await fireEvent.press(screen.getByText('Decline'));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('shows no action buttons for an accepted responsibility belonging to another member', async () => {
    const acceptedForOther: FamilyResponsibilityItem = {
      ...RESPONSIBILITY,
      assigneeMemberId: 'member-other',
      status: 'accepted',
    };
    await renderWithTheme(
      <ResponsibilityRow
        responsibility={acceptedForOther}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.queryByText('Take')).not.toBeOnTheScreen();
    expect(screen.queryByText('Accept')).not.toBeOnTheScreen();
    expect(screen.queryByText('Decline')).not.toBeOnTheScreen();
  });

  it('renders the type label, event title, and resolved assignee status text', async () => {
    const acceptedForOther: FamilyResponsibilityItem = {
      ...RESPONSIBILITY,
      type: 'pick_up',
      assigneeMemberId: 'member-other',
      status: 'accepted',
    };
    await renderWithTheme(
      <ResponsibilityRow
        responsibility={acceptedForOther}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByText('Pick up — Swimming')).toBeOnTheScreen();
    expect(screen.getByText('Accepted by Jamie')).toBeOnTheScreen();
  });

  it('disables the Take button while a mutation is in flight (isBusy) without a separate disabled prop', async () => {
    await renderWithTheme(
      <ResponsibilityRow
        responsibility={RESPONSIBILITY}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        isBusy
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByText('Take')).toBeDisabled();
  });

  it('disables the Take button when offline (disabled=true) even though no mutation is in flight', async () => {
    await renderWithTheme(
      <ResponsibilityRow
        responsibility={RESPONSIBILITY}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        isBusy={false}
        disabled
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByText('Take')).toBeDisabled();
  });

  it('carries deterministic testIDs keyed by the responsibility id, for automation', async () => {
    const pendingForMe: FamilyResponsibilityItem = {
      ...RESPONSIBILITY,
      assigneeMemberId: 'member-me',
      status: 'pending_acceptance',
    };
    await renderWithTheme(
      <ResponsibilityRow
        responsibility={pendingForMe}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByTestId('responsibility-accept-r1')).toBeOnTheScreen();
    expect(screen.getByTestId('responsibility-decline-r1')).toBeOnTheScreen();
  });
});
