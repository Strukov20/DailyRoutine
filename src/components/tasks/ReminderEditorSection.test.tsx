import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import { existingReminderOffsets, ReminderEditorSection } from './ReminderEditorSection';

initI18n();

const mockReminders = { data: [] as { id: string; offsetMinutesBefore: number | null; remindAt: string | null }[] };
const mockCreate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/domain/recurrence/hooks', () => ({
  useTaskReminders: () => mockReminders,
  useCreateTaskReminder: () => ({ mutateAsync: mockCreate }),
  useDeleteTaskReminder: () => ({ mutateAsync: mockDelete }),
}));

// Explicit factory, not automock: the real module transitively imports
// @/lib/supabase/client -> AsyncStorage, which has no native module under
// Jest (see docs/TEST_STRATEGY.md).
jest.mock('@/lib/notifications/notificationService', () => ({
  getNotificationPermissionStatus: jest.fn().mockResolvedValue('granted'),
  requestNotificationPermission: jest.fn().mockResolvedValue('granted'),
}));

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

afterEach(() => {
  jest.clearAllMocks();
  mockReminders.data = [];
});

describe('ReminderEditorSection', () => {
  it('shows a hint instead of the add button when the task has no start_time', async () => {
    await renderWithTheme(<ReminderEditorSection taskId="t1" hasStartTime={false} />);

    expect(screen.getByText("This task has no time to be relative to — pick an exact date and time instead.")).toBeOnTheScreen();
    expect(screen.queryByTestId('add-reminder-button')).not.toBeOnTheScreen();
  });

  it('shows the add-reminder button for a timed task', async () => {
    await renderWithTheme(<ReminderEditorSection taskId="t1" hasStartTime />);

    expect(screen.getByTestId('add-reminder-button')).toBeOnTheScreen();
  });

  it('lists existing reminders by their preset label', async () => {
    mockReminders.data = [{ id: 'r1', offsetMinutesBefore: 15, remindAt: null }];
    await renderWithTheme(<ReminderEditorSection taskId="t1" hasStartTime />);

    expect(screen.getByTestId('reminder-row-r1')).toBeOnTheScreen();
    expect(screen.getByText('15 minutes before')).toBeOnTheScreen();
  });

  // react-native-paper's <Menu> never reliably mounts its Portal content
  // under react-test-renderer (see docs/TEST_STRATEGY.md / AssigneePicker.test.tsx
  // — no other component in this codebase drives a Menu open in tests
  // either). Confirmed here too: a menu-item-text assertion that passes in
  // isolation intermittently fails when the full suite runs. The trigger
  // button itself (tested above) is what's reliably observable; adding a
  // preset and duplicate-time prevention are exercised structurally
  // instead, via the pure existingOffsets check the component wires the
  // menu items' `disabled` prop from — see the component's own addPreset().

  it('removing a reminder calls the delete mutation with its id', async () => {
    mockReminders.data = [{ id: 'r1', offsetMinutesBefore: 30, remindAt: null }];
    await renderWithTheme(<ReminderEditorSection taskId="t1" hasStartTime />);

    await fireEvent.press(screen.getByLabelText('Remove reminder'));

    expect(mockDelete).toHaveBeenCalledWith('r1');
  });
});

describe('existingReminderOffsets', () => {
  it('collects every non-null offset into a set', () => {
    const offsets = existingReminderOffsets([
      { offsetMinutesBefore: 15 },
      { offsetMinutesBefore: 60 },
      { offsetMinutesBefore: null }, // an absolute reminder — no offset to collide on
    ]);

    expect(offsets).toEqual(new Set([15, 60]));
  });

  it('is empty for no reminders', () => {
    expect(existingReminderOffsets([])).toEqual(new Set());
  });

  it('correctly flags a duplicate-time candidate (the exact check addPreset relies on)', () => {
    const offsets = existingReminderOffsets([{ offsetMinutesBefore: 15 }]);
    expect(offsets.has(15)).toBe(true);
    expect(offsets.has(30)).toBe(false);
  });
});
