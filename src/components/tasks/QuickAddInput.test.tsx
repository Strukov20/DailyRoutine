import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { initI18n } from '@/i18n';
import { createPersonalTask } from '@/lib/tasks/taskService';
import { AppThemeProvider } from '@/theme';

import { QuickAddInput } from './QuickAddInput';

initI18n();

// A manual factory (not a bare `jest.mock('@/lib/tasks/taskService')`) —
// automock still evaluates the real module, which imports the real
// Supabase client and its AsyncStorage native module. See
// src/domain/family/hooks.test.tsx for the same fix and full explanation.
jest.mock('@/lib/tasks/taskService', () => ({
  createPersonalTask: jest.fn(),
}));

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    profile: { id: 'u1' },
    session: null,
    status: 'signed-in',
    refreshProfile: jest.fn(),
  }),
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

describe('QuickAddInput', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates a task, clears the input, and shows a subtle confirmation', async () => {
    (createPersonalTask as jest.Mock).mockResolvedValue('t1');

    await renderWithProviders(<QuickAddInput screenId="test" />);

    const input = screen.getByPlaceholderText('Add a task…');
    await fireEvent.changeText(input, 'Buy milk');
    await fireEvent(input, 'submitEditing');

    await waitFor(() =>
      expect(createPersonalTask).toHaveBeenCalledWith({ title: 'Buy milk', date: undefined }),
    );
    await waitFor(() => expect(input.props.value).toBe(''));
  });

  it('passes the given date through for Today/Tomorrow quick-add', async () => {
    (createPersonalTask as jest.Mock).mockResolvedValue('t1');

    await renderWithProviders(<QuickAddInput date="2026-09-03" screenId="test" />);

    const input = screen.getByPlaceholderText('Add a task…');
    await fireEvent.changeText(input, 'Timed task');
    await fireEvent(input, 'submitEditing');

    await waitFor(() =>
      expect(createPersonalTask).toHaveBeenCalledWith({ title: 'Timed task', date: '2026-09-03' }),
    );
  });

  it('never submits a blank title', async () => {
    await renderWithProviders(<QuickAddInput screenId="test" />);

    const input = screen.getByPlaceholderText('Add a task…');
    await fireEvent(input, 'submitEditing');

    expect(createPersonalTask).not.toHaveBeenCalled();
  });

  it('prevents a duplicate submission from a repeated tap while the mutation is in flight', async () => {
    let resolveCreate: (value: string) => void = () => {};
    (createPersonalTask as jest.Mock).mockReturnValue(
      new Promise<string>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    await renderWithProviders(<QuickAddInput screenId="test" />);

    const input = screen.getByPlaceholderText('Add a task…');
    await fireEvent.changeText(input, 'Buy milk');
    // Two rapid submissions while the first call is still pending.
    await fireEvent(input, 'submitEditing');
    await fireEvent(input, 'submitEditing');

    expect(createPersonalTask).toHaveBeenCalledTimes(1);

    resolveCreate('t1');
    await waitFor(() => expect(input.props.value).toBe(''));
  });
});
