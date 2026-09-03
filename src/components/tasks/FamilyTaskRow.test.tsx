import { fireEvent, render, screen } from '@testing-library/react-native';

import type { FamilyMember } from '@/domain/family/types';
import type { Task } from '@/domain/tasks/types';
import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import { FamilyTaskRow } from './FamilyTaskRow';

initI18n();

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

const TASK: Task = {
  id: 't1',
  ownerProfileId: 'owner-profile',
  familyId: 'f1',
  title: 'Take out the trash',
  description: null,
  date: '2026-09-03',
  startTime: null,
  durationMinutes: null,
  timezone: null,
  priority: 'normal',
  categoryId: null,
  visibility: 'family',
  completedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  assigneeMemberId: null,
  assignmentStatus: 'unassigned',
};

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

const NOOP_HANDLERS = {
  onTake: jest.fn(),
  onAccept: jest.fn(),
  onDecline: jest.fn(),
  onAssign: jest.fn(),
  onReassign: jest.fn(),
  onUnassign: jest.fn(),
  onToggleComplete: jest.fn(),
  onEdit: jest.fn(),
  onArchive: jest.fn(),
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('FamilyTaskRow', () => {
  it('shows a Take button for an unassigned task and calls onTake when pressed', async () => {
    const onTake = jest.fn();
    await renderWithTheme(
      <FamilyTaskRow
        task={TASK}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage={false}
        isBusy={false}
        {...NOOP_HANDLERS}
        onTake={onTake}
      />,
    );

    await fireEvent.press(screen.getByText('Take'));

    expect(onTake).toHaveBeenCalledTimes(1);
  });

  it('shows Accept/Decline only to the pending recipient, not to another member', async () => {
    const pendingForMe: Task = {
      ...TASK,
      assigneeMemberId: 'member-me',
      assignmentStatus: 'pending_acceptance',
    };
    await renderWithTheme(
      <FamilyTaskRow
        task={pendingForMe}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage={false}
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByText('Accept')).toBeOnTheScreen();
    expect(screen.getByText('Decline')).toBeOnTheScreen();
  });

  it('does not show Accept/Decline to a member who is not the pending recipient', async () => {
    const pendingForOther: Task = {
      ...TASK,
      assigneeMemberId: 'member-other',
      assignmentStatus: 'pending_acceptance',
    };
    await renderWithTheme(
      <FamilyTaskRow
        task={pendingForOther}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage={false}
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
    const pendingForMe: Task = {
      ...TASK,
      assigneeMemberId: 'member-me',
      assignmentStatus: 'pending_acceptance',
    };
    await renderWithTheme(
      <FamilyTaskRow
        task={pendingForMe}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage={false}
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

  it('does not offer the Assign action to a non-manager', async () => {
    await renderWithTheme(
      <FamilyTaskRow
        task={TASK}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage={false}
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.queryByText('Assign')).not.toBeOnTheScreen();
  });

  it('offers the Assign action to a manager (creator or owner) for an unassigned task', async () => {
    await renderWithTheme(
      <FamilyTaskRow
        task={TASK}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByText('Assign')).toBeOnTheScreen();
  });

  it('offers Reassign and Unassign, not Assign, to a manager once the task has an assignee', async () => {
    const acceptedTask: Task = {
      ...TASK,
      assigneeMemberId: 'member-other',
      assignmentStatus: 'accepted',
    };
    await renderWithTheme(
      <FamilyTaskRow
        task={acceptedTask}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.queryByText('Assign')).not.toBeOnTheScreen();
    expect(screen.getByText('Reassign')).toBeOnTheScreen();
    expect(screen.getByText('Unassign')).toBeOnTheScreen();
  });

  it('shows the completion checkbox only when the caller can complete the task', async () => {
    const ownedTask: Task = { ...TASK, ownerProfileId: 'me-profile' };
    await renderWithTheme(
      <FamilyTaskRow
        task={ownedTask}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByRole('checkbox')).toBeOnTheScreen();
  });

  it('hides the completion checkbox for a task the caller neither owns nor is the accepted assignee of', async () => {
    const someoneElsesTask: Task = {
      ...TASK,
      ownerProfileId: 'other-profile',
      assigneeMemberId: 'member-other',
      assignmentStatus: 'accepted',
    };
    await renderWithTheme(
      <FamilyTaskRow
        task={someoneElsesTask}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage={false}
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
  });

  it('disables the Take button while a mutation is in flight (isBusy) without requiring a separate disabled prop', async () => {
    await renderWithTheme(
      <FamilyTaskRow
        task={TASK}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage={false}
        isBusy
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByText('Take')).toBeDisabled();
  });

  it('disables assignment actions when offline (disabled=true) even though no mutation is in flight', async () => {
    await renderWithTheme(
      <FamilyTaskRow
        task={TASK}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage={false}
        isBusy={false}
        disabled
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByText('Take')).toBeDisabled();
  });

  it('shows the assignee label resolved from the members list', async () => {
    const assignedTask: Task = {
      ...TASK,
      assigneeMemberId: 'member-other',
      assignmentStatus: 'accepted',
    };
    await renderWithTheme(
      <FamilyTaskRow
        task={assignedTask}
        members={MEMBERS}
        currentProfileId="me-profile"
        currentMemberId="member-me"
        canManage={false}
        isBusy={false}
        {...NOOP_HANDLERS}
      />,
    );

    expect(screen.getByText('Assigned to Jamie')).toBeOnTheScreen();
  });
});
