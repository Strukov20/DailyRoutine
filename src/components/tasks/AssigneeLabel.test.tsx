import { render, screen } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import { AssigneeLabel } from './AssigneeLabel';

initI18n();

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

describe('AssigneeLabel', () => {
  it('shows "Unassigned" when there is no assignee', async () => {
    await renderWithTheme(
      <AssigneeLabel assignmentStatus="unassigned" assigneeName={null} isMe={false} />,
    );

    expect(screen.getByText('Unassigned')).toBeOnTheScreen();
  });

  it('shows "Unassigned" when assignmentStatus is unassigned even if a stale name is passed', async () => {
    await renderWithTheme(
      <AssigneeLabel assignmentStatus="unassigned" assigneeName="Alex" isMe={false} />,
    );

    expect(screen.getByText('Unassigned')).toBeOnTheScreen();
  });

  it('shows "Pending on <name>" for a pending assignment to someone else', async () => {
    await renderWithTheme(
      <AssigneeLabel assignmentStatus="pending_acceptance" assigneeName="Alex" isMe={false} />,
    );

    expect(screen.getByText('Pending on Alex')).toBeOnTheScreen();
  });

  it('shows "Pending on you" for the current user\'s own pending assignment', async () => {
    await renderWithTheme(
      <AssigneeLabel assignmentStatus="pending_acceptance" assigneeName="Alex" isMe />,
    );

    expect(screen.getByText('Pending on you')).toBeOnTheScreen();
  });

  it('shows "Assigned to <name>" for an accepted assignment to someone else', async () => {
    await renderWithTheme(
      <AssigneeLabel assignmentStatus="accepted" assigneeName="Jamie" isMe={false} />,
    );

    expect(screen.getByText('Assigned to Jamie')).toBeOnTheScreen();
  });

  it('shows "Assigned to you" for the current user\'s own accepted assignment', async () => {
    await renderWithTheme(<AssigneeLabel assignmentStatus="accepted" assigneeName="Jamie" isMe />);

    expect(screen.getByText('Assigned to you')).toBeOnTheScreen();
  });
});
