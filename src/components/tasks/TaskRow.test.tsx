import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Task } from '@/domain/tasks/types';
import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import { TaskRow } from './TaskRow';

initI18n();

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

const TASK: Task = {
  id: 't1',
  ownerProfileId: 'u1',
  familyId: null,
  title: 'Buy milk',
  description: null,
  date: '2026-09-03',
  startTime: null,
  durationMinutes: null,
  timezone: null,
  priority: 'normal',
  categoryId: null,
  visibility: 'private',
  completedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('TaskRow', () => {
  it('renders the task title', async () => {
    await renderWithTheme(
      <TaskRow task={TASK} onToggleComplete={jest.fn()} onEdit={jest.fn()} onArchive={jest.fn()} />,
    );

    expect(screen.getByText('Buy milk')).toBeOnTheScreen();
  });

  it('calls onToggleComplete when the checkbox is pressed', async () => {
    const onToggleComplete = jest.fn();
    await renderWithTheme(
      <TaskRow task={TASK} onToggleComplete={onToggleComplete} onEdit={jest.fn()} onArchive={jest.fn()} />,
    );

    await fireEvent.press(screen.getByRole('checkbox'));

    expect(onToggleComplete).toHaveBeenCalledTimes(1);
  });

  it("the checkbox's accessibility state reflects completion, not color alone", async () => {
    await renderWithTheme(
      <TaskRow
        task={{ ...TASK, completedAt: '2026-09-01T00:00:00.000Z' }}
        onToggleComplete={jest.fn()}
        onEdit={jest.fn()}
        onArchive={jest.fn()}
      />,
    );

    expect(screen.getByRole('checkbox').props.accessibilityState.checked).toBe(true);
  });

  it('does not toggle while a completion mutation is already in flight (duplicate-tap prevention)', async () => {
    const onToggleComplete = jest.fn();
    await renderWithTheme(
      <TaskRow
        task={TASK}
        onToggleComplete={onToggleComplete}
        isTogglingComplete
        onEdit={jest.fn()}
        onArchive={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByRole('checkbox'));

    expect(onToggleComplete).not.toHaveBeenCalled();
  });

  it('calls onEdit when the row content is pressed', async () => {
    const onEdit = jest.fn();
    await renderWithTheme(
      <TaskRow task={TASK} onToggleComplete={jest.fn()} onEdit={onEdit} onArchive={jest.fn()} />,
    );

    await fireEvent.press(screen.getByText('Buy milk'));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('shows the overdue indicator only when showOverdue is set', async () => {
    await renderWithTheme(
      <TaskRow task={TASK} onToggleComplete={jest.fn()} onEdit={jest.fn()} onArchive={jest.fn()} showOverdue />,
    );

    expect(screen.getByText('Overdue')).toBeOnTheScreen();
  });
});
