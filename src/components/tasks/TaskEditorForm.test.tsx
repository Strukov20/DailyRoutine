import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import { TaskEditorForm } from './TaskEditorForm';

initI18n();

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
}));

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'me-profile' } }),
}));

jest.mock('@/domain/categories/hooks', () => ({
  useCategories: () => ({ data: [] }),
  useCreateCustomCategory: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('@/domain/family/hooks', () => ({
  useFamilyMembers: () => ({ data: [] }),
}));

const mockCreateTask = jest.fn();
const mockUpdateTask = jest.fn();
const mockScheduleTask = jest.fn();
const mockCreateSharedTask = jest.fn();

jest.mock('@/domain/tasks/hooks', () => ({
  useCreatePersonalTask: () => ({ mutateAsync: mockCreateTask, isPending: false }),
  useCreateSharedFamilyTask: () => ({ mutateAsync: mockCreateSharedTask, isPending: false }),
  useSchedulePersonalTask: () => ({ mutateAsync: mockScheduleTask, isPending: false }),
  useUpdatePersonalTask: () => ({ mutateAsync: mockUpdateTask, isPending: false }),
}));

const mockCreateRecurringTask = jest.fn();
const mockUpdateRecurringSeries = jest.fn();
const mockStopRecurringSeries = jest.fn().mockResolvedValue(undefined);

jest.mock('@/domain/recurrence/hooks', () => ({
  useCreateRecurringTask: () => ({ mutateAsync: mockCreateRecurringTask, isPending: false }),
  useUpdateRecurringSeries: () => ({ mutateAsync: mockUpdateRecurringSeries, isPending: false }),
  useStopRecurringSeries: () => ({ mutateAsync: mockStopRecurringSeries, isPending: false }),
  useTaskReminders: () => ({ data: [] }),
  useCreateTaskReminder: () => ({ mutateAsync: jest.fn() }),
  useDeleteTaskReminder: () => ({ mutateAsync: jest.fn() }),
}));

// Explicit factories, not automocks: the real modules transitively import
// @/lib/supabase/client -> AsyncStorage, which has no native module under
// Jest (see docs/TEST_STRATEGY.md).
jest.mock('@/lib/notifications/notificationService', () => ({
  getNotificationPermissionStatus: jest.fn().mockResolvedValue('granted'),
  requestNotificationPermission: jest.fn().mockResolvedValue('granted'),
}));

jest.mock('@/lib/recurrence/recurrenceService', () => ({
  RecurrenceServiceError: class RecurrenceServiceError extends Error {},
}));

jest.mock('@/lib/tasks/taskService', () => ({
  moveTaskToInbox: jest.fn(),
  TaskServiceError: class TaskServiceError extends Error {},
}));

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

afterEach(() => {
  jest.clearAllMocks();
});

const BASE_INITIAL_VALUES = {
  title: 'Water the plants',
  priority: 'normal' as const,
  visibility: 'private' as const,
};

describe('TaskEditorForm — occurrence vs. series UX (Phase 8 audit)', () => {
  it('a recurring series shows the series-wide-edit notice, never a per-occurrence content option', async () => {
    await renderWithTheme(
      <TaskEditorForm
        mode="edit"
        taskId="series-task-1"
        initialValues={BASE_INITIAL_VALUES}
        onDone={jest.fn()}
        isRecurringSeries
      />,
    );

    expect(
      screen.getByText(
        "This task repeats. Editing here changes every future occurrence — an occurrence you've already completed or individually rescheduled is never changed.",
      ),
    ).toBeOnTheScreen();

    // The exact, deliberately unused i18n strings this audit removed as dead
    // scaffolding (see docs/DECISIONS.md, "Phase 8") must never render
    // anywhere in the editor — there is no per-occurrence content-edit
    // option to expose, implemented or otherwise.
    expect(screen.queryByText('This occurrence')).not.toBeOnTheScreen();
    expect(screen.queryByText('Entire series')).not.toBeOnTheScreen();
  });

  it('a non-recurring task never shows the series notice or a Stop repeating action', async () => {
    await renderWithTheme(
      <TaskEditorForm
        mode="edit"
        taskId="plain-task-1"
        initialValues={BASE_INITIAL_VALUES}
        onDone={jest.fn()}
      />,
    );

    expect(screen.queryByText(/This task repeats/)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('stop-repeating-button')).not.toBeOnTheScreen();
  });

  it('Stop repeating opens a confirm dialog with exactly two actions — Cancel and Stop repeating, never a third option', async () => {
    await renderWithTheme(
      <TaskEditorForm
        mode="edit"
        taskId="series-task-1"
        initialValues={BASE_INITIAL_VALUES}
        onDone={jest.fn()}
        isRecurringSeries
      />,
    );

    await fireEvent.press(screen.getByTestId('stop-repeating-button'));

    expect(screen.getByText('Stop this series?')).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Future occurrences will be removed. Occurrences you've already completed stay in your history.",
      ),
    ).toBeOnTheScreen();
    // Exactly the confirm/cancel pair — no "this occurrence" alternative.
    expect(screen.getAllByText('Cancel')).toHaveLength(1);
    expect(screen.getAllByText('Stop repeating')).toHaveLength(2); // the trigger button + the dialog's confirm action
  });

  it('confirming Stop repeating calls stopRecurringSeries with the series task id, once, and never update_recurring_series', async () => {
    const onDone = jest.fn();
    await renderWithTheme(
      <TaskEditorForm
        mode="edit"
        taskId="series-task-1"
        initialValues={BASE_INITIAL_VALUES}
        onDone={onDone}
        isRecurringSeries
      />,
    );

    await fireEvent.press(screen.getByTestId('stop-repeating-button'));
    const [, confirmAction] = screen.getAllByText('Stop repeating');
    await fireEvent.press(confirmAction!);

    expect(mockStopRecurringSeries).toHaveBeenCalledTimes(1);
    expect(mockStopRecurringSeries).toHaveBeenCalledWith('series-task-1');
    expect(mockUpdateRecurringSeries).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('cancelling the confirm dialog never calls stopRecurringSeries', async () => {
    await renderWithTheme(
      <TaskEditorForm
        mode="edit"
        taskId="series-task-1"
        initialValues={BASE_INITIAL_VALUES}
        onDone={jest.fn()}
        isRecurringSeries
      />,
    );

    await fireEvent.press(screen.getByTestId('stop-repeating-button'));
    const [cancelAction] = screen.getAllByText('Cancel');
    await fireEvent.press(cancelAction!);

    expect(mockStopRecurringSeries).not.toHaveBeenCalled();
  });

  it('the Repeat picker is never offered when editing an existing task (recurrence_rules has no client SELECT grant to re-populate it from)', async () => {
    await renderWithTheme(
      <TaskEditorForm
        mode="edit"
        taskId="series-task-1"
        initialValues={BASE_INITIAL_VALUES}
        onDone={jest.fn()}
        isRecurringSeries
      />,
    );

    expect(screen.queryByText('Repeat')).not.toBeOnTheScreen();
  });
});
