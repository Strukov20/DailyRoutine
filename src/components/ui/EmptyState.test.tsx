import { render, screen, fireEvent } from '@testing-library/react-native';

import { AppThemeProvider } from '@/theme';

import { EmptyState } from './EmptyState';

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

describe('EmptyState', () => {
  it('renders the title and description', async () => {
    await renderWithTheme(<EmptyState title="Nothing here" description="Come back later" />);

    expect(screen.getByText('Nothing here')).toBeOnTheScreen();
    expect(screen.getByText('Come back later')).toBeOnTheScreen();
  });

  it('does not render an action when none is provided', async () => {
    await renderWithTheme(<EmptyState title="Nothing here" />);

    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('invokes onAction when the action button is pressed', async () => {
    const onAction = jest.fn();
    await renderWithTheme(
      <EmptyState title="Nothing here" actionLabel="Create" onAction={onAction} />,
    );

    await fireEvent.press(screen.getByText('Create'));

    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
