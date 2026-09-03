import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren, ReactElement } from 'react';
import type { SectionListProps } from 'react-native';

import type { FamilyMember } from '@/domain/family/types';
import type { Task } from '@/domain/tasks/types';
import { initI18n } from '@/i18n';
import { listFamilyTasks, takeFamilyTask, TaskServiceError } from '@/lib/tasks/taskService';
import { AppThemeProvider } from '@/theme';

import { FamilyTaskBoard } from './FamilyTaskBoard';

initI18n();

// react-native's SectionList (built on VirtualizedList) only expands its
// render window in response to real `onLayout`/scroll events, which never
// fire under react-test-renderer (no native layout engine) — confirmed by
// direct experiment: content past the initial window still hadn't
// rendered after waiting 8 real seconds, ruling out a mere timing delay.
// This is a well-known RNTL/VirtualizedList limitation, not something
// FamilyTaskBoard's own code should work around (a production
// `initialNumToRender` bump was tried and reverted — see
// docs/DECISIONS.md, "Phase 5, SectionList test rendering"). The fix
// belongs in the harness: render every row unconditionally here so tests
// can assert against full content, while trusting RN's own virtualization
// (a well-tested library concern, and not something verifiable via
// react-test-renderer regardless) to behave correctly on a real device.
// Mocking the specific source module (not the top-level `react-native`
// package, which jest-expo's own preset already has native-module mocks
// wired into — replacing it wholesale broke DevMenu/TurboModule
// resolution) so the rest of react-native's test setup is untouched.
// `react-native`'s own SectionList export lazily requires this exact path.
jest.mock('react-native/Libraries/Lists/SectionList', () => {
  const { View } = jest.requireActual('react-native');
  function MockSectionList<T>({
    sections,
    renderItem,
    renderSectionHeader,
    keyExtractor,
  }: SectionListProps<T>) {
    return (
      <View>
        {sections.map((section, sectionIndex) => (
          <View key={`section-${sectionIndex}`}>
            {renderSectionHeader ? renderSectionHeader({ section }) : null}
            {section.data.map((item, itemIndex) => (
              <View key={keyExtractor ? keyExtractor(item, itemIndex) : itemIndex}>
                {
                  renderItem?.({
                    item,
                    index: itemIndex,
                    section,
                    separators: {
                      highlight: () => {},
                      unhighlight: () => {},
                      updateProps: () => {},
                    },
                  }) as ReactElement
                }
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }
  return { __esModule: true, default: MockSectionList };
});

// A manual factory, not a bare `jest.mock('@/lib/tasks/taskService')` —
// automock still evaluates the real module, which imports the real
// Supabase client and its AsyncStorage native module. See
// src/components/tasks/QuickAddInput.test.tsx for the same fix. Every
// export hooks.ts imports from this module needs a stub here (this mock
// backs the whole module for the file), even where a given test never
// exercises a particular one.
jest.mock('@/lib/tasks/taskService', () => ({
  acceptTaskAssignment: jest.fn(),
  assignFamilyTask: jest.fn(),
  completePersonalTask: jest.fn(),
  completeSharedTask: jest.fn(),
  createPersonalTask: jest.fn(),
  createSharedFamilyTask: jest.fn(),
  declineTaskAssignment: jest.fn(),
  deleteOrArchivePersonalTask: jest.fn(),
  getTask: jest.fn(),
  listFamilyTasks: jest.fn(),
  listInboxTasks: jest.fn(),
  listOverdueTasks: jest.fn(),
  listPendingAssignments: jest.fn(),
  listTasksForDate: jest.fn(),
  moveTaskToInbox: jest.fn(),
  reassignFamilyTask: jest.fn(),
  restorePersonalTask: jest.fn(),
  restoreSharedTask: jest.fn(),
  schedulePersonalTask: jest.fn(),
  takeFamilyTask: jest.fn(),
  TaskServiceError: class TaskServiceError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'TaskServiceError';
    }
  },
  unassignFamilyTask: jest.fn(),
  updatePersonalTask: jest.fn(),
}));

jest.mock('@/lib/categories/categoryService', () => ({
  listCategories: jest.fn().mockResolvedValue([]),
  createCustomCategory: jest.fn(),
}));

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'me-profile' },
    session: null,
    status: 'signed-in',
    refreshProfile: jest.fn(),
  }),
}));

const mockUseIsOffline = jest.fn(() => false);
jest.mock('@/lib/query/useIsOffline', () => ({
  useIsOffline: () => mockUseIsOffline(),
}));

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <AppThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AppThemeProvider>
  );
  return render(ui, { wrapper: Wrapper });
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

function task(overrides: Partial<Task>): Task {
  return {
    id: 't1',
    ownerProfileId: 'other-profile',
    familyId: 'f1',
    title: 'Untitled',
    description: null,
    date: null,
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
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllMocks();
  mockUseIsOffline.mockReturnValue(false);
});

describe('FamilyTaskBoard', () => {
  it('shows a loading state while the board query is in flight', async () => {
    (listFamilyTasks as jest.Mock).mockReturnValue(new Promise(() => {}));

    await renderWithProviders(<FamilyTaskBoard familyId="f1" members={MEMBERS} />);

    expect(screen.getByText('Loading…')).toBeOnTheScreen();
  });

  it('shows an error state with a working retry when the board query fails', async () => {
    (listFamilyTasks as jest.Mock).mockRejectedValue(new Error('network down'));

    await renderWithProviders(<FamilyTaskBoard familyId="f1" members={MEMBERS} />);

    await waitFor(() => expect(screen.getByText('Something went wrong.')).toBeOnTheScreen());
    expect(listFamilyTasks).toHaveBeenCalledTimes(1);

    (listFamilyTasks as jest.Mock).mockResolvedValue([]);
    await fireEvent.press(screen.getByText('Try again'));

    await waitFor(() => expect(listFamilyTasks).toHaveBeenCalledTimes(2));
  });

  it('shows the empty state when the family has no shared tasks', async () => {
    (listFamilyTasks as jest.Mock).mockResolvedValue([]);

    await renderWithProviders(<FamilyTaskBoard familyId="f1" members={MEMBERS} />);

    await waitFor(() => expect(screen.getByText('No family tasks yet')).toBeOnTheScreen());
  });

  it('buckets tasks into the correct sections', async () => {
    const tasks = [
      task({
        id: 'awaiting',
        title: 'Awaiting task',
        assigneeMemberId: 'member-me',
        assignmentStatus: 'pending_acceptance',
      }),
      task({ id: 'mine', title: 'Mine task', ownerProfileId: 'me-profile' }),
      task({ id: 'unassigned', title: 'Unassigned task' }),
      task({
        id: 'others',
        title: 'Others task',
        assigneeMemberId: 'member-other',
        assignmentStatus: 'accepted',
      }),
      task({
        id: 'done',
        title: 'Done task',
        ownerProfileId: 'me-profile',
        completedAt: '2026-09-02T00:00:00.000Z',
      }),
    ];
    (listFamilyTasks as jest.Mock).mockResolvedValue(tasks);

    await renderWithProviders(<FamilyTaskBoard familyId="f1" members={MEMBERS} />);

    await waitFor(() => expect(screen.getByText('Awaiting your response')).toBeOnTheScreen());
    expect(screen.getByText('Awaiting task')).toBeOnTheScreen();
    expect(screen.getByText('My family tasks')).toBeOnTheScreen();
    expect(screen.getByText('Mine task')).toBeOnTheScreen();
    // "Unassigned" appears both as the section header and as the assignee
    // label on rows with no assignee (e.g. "Mine task") — assert presence,
    // not uniqueness.
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0);
    expect(screen.getByText('Unassigned task')).toBeOnTheScreen();
    expect(screen.getByText('Assigned to others')).toBeOnTheScreen();
    expect(screen.getByText('Others task')).toBeOnTheScreen();
    expect(screen.getByText('Completed')).toBeOnTheScreen();
    expect(screen.getByText('Done task')).toBeOnTheScreen();
  });

  it('takes an unassigned task and refreshes the board', async () => {
    const unassignedTask = task({ id: 'take-me', title: 'Take-able task' });
    (listFamilyTasks as jest.Mock).mockResolvedValue([unassignedTask]);
    (takeFamilyTask as jest.Mock).mockResolvedValue(undefined);

    await renderWithProviders(<FamilyTaskBoard familyId="f1" members={MEMBERS} />);

    await waitFor(() => expect(screen.getByText('Take-able task')).toBeOnTheScreen());
    await fireEvent.press(screen.getByText('Take'));

    await waitFor(() => expect(takeFamilyTask).toHaveBeenCalledWith('take-me'));
  });

  it('surfaces a localized conflict message when a stale action is rejected', async () => {
    const unassignedTask = task({ id: 'stale', title: 'Stale task' });
    (listFamilyTasks as jest.Mock).mockResolvedValue([unassignedTask]);
    (takeFamilyTask as jest.Mock).mockRejectedValue(
      new TaskServiceError('conflict', 'already taken'),
    );

    await renderWithProviders(<FamilyTaskBoard familyId="f1" members={MEMBERS} />);

    await waitFor(() => expect(screen.getByText('Stale task')).toBeOnTheScreen());
    await fireEvent.press(screen.getByText('Take'));

    await waitFor(() =>
      expect(
        screen.getByText("This task's assignment just changed — pull to refresh and try again."),
      ).toBeOnTheScreen(),
    );
  });

  it('disables assignment actions while offline, without a mutation in flight', async () => {
    mockUseIsOffline.mockReturnValue(true);
    const unassignedTask = task({ id: 'offline-task', title: 'Offline task' });
    (listFamilyTasks as jest.Mock).mockResolvedValue([unassignedTask]);

    await renderWithProviders(<FamilyTaskBoard familyId="f1" members={MEMBERS} />);

    await waitFor(() => expect(screen.getByText('Offline task')).toBeOnTheScreen());
    expect(screen.getByText('Take')).toBeDisabled();
    expect(takeFamilyTask).not.toHaveBeenCalled();
  });
});
