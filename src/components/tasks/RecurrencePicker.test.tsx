import { fireEvent, render, screen } from '@testing-library/react-native';

import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import { RecurrencePicker, type RecurrenceState } from './RecurrencePicker';

initI18n();

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

const NONE_STATE: RecurrenceState = { frequency: 'none', interval: 1, byWeekday: [], endCondition: 'never' };

afterEach(() => {
  jest.clearAllMocks();
});

describe('RecurrencePicker', () => {
  it('shows no interval/weekday/end-condition controls when frequency is "none"', async () => {
    await renderWithTheme(<RecurrencePicker value={NONE_STATE} onChange={jest.fn()} />);

    expect(screen.queryByTestId('recurrence-interval')).not.toBeOnTheScreen();
    expect(screen.queryByText('Ends')).not.toBeOnTheScreen();
  });

  it('calls onChange with the new frequency when a repeat option is pressed', async () => {
    const onChange = jest.fn();
    await renderWithTheme(<RecurrencePicker value={NONE_STATE} onChange={onChange} />);

    await fireEvent.press(screen.getByText('Daily'));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ frequency: 'daily' }));
  });

  it('shows the weekday chips only for weekly frequency', async () => {
    await renderWithTheme(
      <RecurrencePicker value={{ ...NONE_STATE, frequency: 'daily', interval: 1 }} onChange={jest.fn()} />,
    );
    expect(screen.queryByTestId('recurrence-weekday-1')).not.toBeOnTheScreen();

    await renderWithTheme(
      <RecurrencePicker value={{ ...NONE_STATE, frequency: 'weekly', byWeekday: [] }} onChange={jest.fn()} />,
    );
    expect(screen.getByTestId('recurrence-weekday-1')).toBeOnTheScreen();
  });

  it('toggles a weekday on and off via onChange', async () => {
    const onChange = jest.fn();
    await renderWithTheme(
      <RecurrencePicker value={{ ...NONE_STATE, frequency: 'weekly', byWeekday: [] }} onChange={onChange} />,
    );

    await fireEvent.press(screen.getByTestId('recurrence-weekday-1'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ byWeekday: [1] }));

    onChange.mockClear();
    await renderWithTheme(
      <RecurrencePicker value={{ ...NONE_STATE, frequency: 'weekly', byWeekday: [1] }} onChange={onChange} />,
    );
    await fireEvent.press(screen.getByTestId('recurrence-weekday-1'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ byWeekday: [] }));
  });

  it('shows the "until" date field only when endCondition is on_date', async () => {
    await renderWithTheme(
      <RecurrencePicker value={{ ...NONE_STATE, frequency: 'daily', endCondition: 'on_date' }} onChange={jest.fn()} />,
    );
    // DateTimeField renders "End date" as both its label and its empty-value placeholder.
    expect(screen.getAllByText('End date').length).toBeGreaterThan(0);
  });

  it('shows the count field only when endCondition is after_count', async () => {
    await renderWithTheme(
      <RecurrencePicker
        value={{ ...NONE_STATE, frequency: 'daily', endCondition: 'after_count' }}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId('recurrence-count')).toBeOnTheScreen();
  });

  it('updates the interval field via onChange, defaulting invalid input to 1', async () => {
    const onChange = jest.fn();
    await renderWithTheme(
      <RecurrencePicker value={{ ...NONE_STATE, frequency: 'daily' }} onChange={onChange} />,
    );

    await fireEvent.changeText(screen.getByTestId('recurrence-interval'), '3');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ interval: 3 }));

    onChange.mockClear();
    await fireEvent.changeText(screen.getByTestId('recurrence-interval'), 'abc');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ interval: 1 }));
  });

  it('surfaces a weekday validation error when provided', async () => {
    await renderWithTheme(
      <RecurrencePicker
        value={{ ...NONE_STATE, frequency: 'weekly', byWeekday: [] }}
        onChange={jest.fn()}
        errors={{ byWeekday: 'Choose at least one weekday.' }}
      />,
    );

    expect(screen.getByText('Choose at least one weekday.')).toBeOnTheScreen();
  });
});
