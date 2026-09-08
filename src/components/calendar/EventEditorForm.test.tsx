import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { FamilyMember } from '@/domain/family/types';
import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import { EventEditorForm } from './EventEditorForm';

initI18n();

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
}));

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ profile: { id: 'me-profile' } }),
}));

const MEMBERS: FamilyMember[] = [
  {
    id: 'member-me',
    familyId: 'f1',
    profileId: 'me-profile',
    displayName: 'Alex',
    role: 'owner',
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
  {
    id: 'member-child',
    familyId: 'f1',
    profileId: null,
    displayName: 'Artem',
    role: 'child',
    memberType: 'child',
    avatarUrl: null,
    dateOfBirth: null,
    removedAt: null,
  },
];

jest.mock('@/domain/family/hooks', () => ({
  useFamilyMembers: () => ({ data: MEMBERS }),
}));

// Explicit factory, not bare automock: the real module transitively imports
// @/lib/supabase/client -> @react-native-async-storage/async-storage, which
// has no native module under Jest (see docs/TEST_STRATEGY.md, "Mock a
// service module with an explicit factory..."). Only CalendarServiceError
// is actually used by EventEditorForm (an `instanceof` check), so a small
// real class stands in for the rest of the module.
jest.mock('@/lib/calendar/calendarService', () => ({
  CalendarServiceError: class CalendarServiceError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

const mockCreatePersonal = { mutateAsync: jest.fn().mockResolvedValue('new-id'), isPending: false };
const mockCreateFamily = { mutateAsync: jest.fn().mockResolvedValue('new-id'), isPending: false };
const mockCreateChild = { mutateAsync: jest.fn().mockResolvedValue('new-id'), isPending: false };
const mockUpdate = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };

jest.mock('@/domain/calendar/hooks', () => ({
  useCreatePersonalEvent: () => mockCreatePersonal,
  useCreateFamilyEvent: () => mockCreateFamily,
  useCreateChildEvent: () => mockCreateChild,
  useUpdateEvent: () => mockUpdate,
  useScheduleConflict: () => ({ data: false }),
}));

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

const FULL_VALUES = {
  kind: 'personal' as const,
  title: 'Dentist',
  date: '2026-09-10',
  startTime: '14:00',
  endTime: '15:00',
  visibility: 'private' as const,
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('EventEditorForm', () => {
  it('renders the title field and reflects typed input', async () => {
    await renderWithTheme(<EventEditorForm mode="create" onDone={jest.fn()} />);

    const titleInput = screen.getByTestId('event-editor-title');
    await fireEvent.changeText(titleInput, 'Swimming');

    expect(titleInput.props.value).toBe('Swimming');
  });

  it('shows a title-required validation error on submit when the title is empty', async () => {
    await renderWithTheme(
      <EventEditorForm mode="create" initialValues={{ ...FULL_VALUES, title: '' }} onDone={jest.fn()} />,
    );

    await fireEvent.press(screen.getByTestId('event-editor-submit'));

    await waitFor(() => {
      expect(screen.getByText('A title is required.')).toBeOnTheScreen();
    });
    expect(mockCreatePersonal.mutateAsync).not.toHaveBeenCalled();
  });

  it('disables the Family and Child kind options when no family is available', async () => {
    await renderWithTheme(<EventEditorForm mode="create" onDone={jest.fn()} />);

    // "Family" also appears as a Personal-mode visibility option — the kind
    // selector's own "Family" button renders first in document order.
    expect(screen.getAllByText('Family')[0]).toBeDisabled();
    expect(screen.getByText('Child')).toBeDisabled();
  });

  it('shows the Private/Family visibility toggle only in Personal mode', async () => {
    await renderWithTheme(
      <EventEditorForm mode="create" initialValues={FULL_VALUES} defaultFamilyId="f1" onDone={jest.fn()} />,
    );

    expect(screen.getByText('Private')).toBeOnTheScreen();
  });

  it('submits create_personal_event with the expected payload for a Personal event', async () => {
    const onDone = jest.fn();
    await renderWithTheme(<EventEditorForm mode="create" initialValues={FULL_VALUES} onDone={onDone} />);

    await fireEvent.press(screen.getByTestId('event-editor-submit'));

    await waitFor(() => expect(mockCreatePersonal.mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mockCreatePersonal.mutateAsync.mock.calls[0][0];
    expect(payload).toMatchObject({
      title: 'Dentist',
      visibility: 'private',
      description: undefined,
      location: undefined,
    });
    expect(payload.startsAt).toContain('2026-09-10');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('submits create_family_event, not create_personal_event, when kind is family', async () => {
    const onDone = jest.fn();
    await renderWithTheme(
      <EventEditorForm
        mode="create"
        initialValues={{ ...FULL_VALUES, kind: 'family', familyId: 'f1' }}
        defaultFamilyId="f1"
        onDone={onDone}
      />,
    );

    await fireEvent.press(screen.getByTestId('event-editor-submit'));

    await waitFor(() => expect(mockCreateFamily.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mockCreatePersonal.mutateAsync).not.toHaveBeenCalled();
    expect(mockCreateFamily.mutateAsync.mock.calls[0][0]).toMatchObject({ title: 'Dentist' });
  });

  it('shows the child/drop-off/pick-up pickers only in create + child mode', async () => {
    await renderWithTheme(
      <EventEditorForm
        mode="create"
        initialValues={{ ...FULL_VALUES, kind: 'child', familyId: 'f1' }}
        defaultFamilyId="f1"
        onDone={jest.fn()}
      />,
    );

    expect(screen.getByTestId('event-editor-child')).toBeOnTheScreen();
    expect(screen.getAllByText('No one yet').length).toBe(2);
  });

  it('rejects submission of a child event with no child selected', async () => {
    await renderWithTheme(
      <EventEditorForm
        mode="create"
        initialValues={{ ...FULL_VALUES, kind: 'child', familyId: 'f1' }}
        defaultFamilyId="f1"
        onDone={jest.fn()}
      />,
    );

    await fireEvent.press(screen.getByTestId('event-editor-submit'));

    await waitFor(() => {
      expect(screen.getByText('Choose which child this event concerns.')).toBeOnTheScreen();
    });
    expect(mockCreateChild.mutateAsync).not.toHaveBeenCalled();
  });

  it('submits update_event in edit mode, addressed to the given eventId', async () => {
    const onDone = jest.fn();
    await renderWithTheme(
      <EventEditorForm mode="edit" eventId="event-1" initialValues={FULL_VALUES} onDone={onDone} />,
    );

    await fireEvent.press(screen.getByTestId('event-editor-submit'));

    await waitFor(() => expect(mockUpdate.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mockUpdate.mutateAsync.mock.calls[0][0]).toMatchObject({ eventId: 'event-1', title: 'Dentist' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('shows a discard-changes confirmation when navigating away with unsaved edits', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let capturedListener: ((event: { preventDefault: () => void; data: { action: unknown } }) => void) | undefined;
    jest.spyOn(require('expo-router'), 'useNavigation').mockReturnValue({
      addListener: (_event: string, listener: typeof capturedListener) => {
        capturedListener = listener;
        return jest.fn();
      },
      dispatch: jest.fn(),
    });

    await renderWithTheme(<EventEditorForm mode="create" onDone={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('event-editor-title'), 'Something new');

    expect(capturedListener).toBeDefined();
    capturedListener?.({ preventDefault: jest.fn(), data: { action: {} } });

    expect(alertSpy).toHaveBeenCalledWith(
      'Discard changes?',
      'You have unsaved changes to this event.',
      expect.any(Array),
    );

    alertSpy.mockRestore();
  });
});
