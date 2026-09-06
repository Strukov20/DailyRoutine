import { render, screen } from '@testing-library/react-native';

import type { FamilyMember } from '@/domain/family/types';
import { initI18n } from '@/i18n';
import { AppThemeProvider } from '@/theme';

import { AssigneePicker } from './AssigneePicker';

initI18n();

function renderWithTheme(ui: React.ReactElement) {
  return render(<AppThemeProvider>{ui}</AppThemeProvider>);
}

function member(overrides: Partial<FamilyMember>): FamilyMember {
  return {
    id: 'm1',
    familyId: 'f1',
    profileId: 'u1',
    displayName: 'Alex',
    role: 'adult',
    memberType: 'adult',
    avatarUrl: null,
    dateOfBirth: null,
    removedAt: null,
    ...overrides,
  };
}

// react-native-paper's <Menu> only mounts its Portal content once it can
// measure its anchor via the native layout system, which isn't available
// under the react-test-renderer environment this project's Jest config
// uses (no other component in this codebase drives a Menu open in tests
// either — see TaskActionMenu, which has no test file). These tests are
// scoped to what's reliably observable without opening the menu: the
// trigger button itself, and the `disabled` prop's effect on it.
describe('AssigneePicker', () => {
  it('renders the given label on the trigger button', async () => {
    await renderWithTheme(
      <AssigneePicker members={[member({})]} label="Assign" onSelect={jest.fn()} />,
    );

    expect(screen.getByText('Assign')).toBeOnTheScreen();
  });

  it('is enabled by default', async () => {
    await renderWithTheme(
      <AssigneePicker members={[member({})]} label="Assign" onSelect={jest.fn()} />,
    );

    expect(screen.getByText('Assign')).not.toBeDisabled();
  });

  it('disables the trigger button when disabled is set', async () => {
    await renderWithTheme(
      <AssigneePicker members={[member({})]} label="Assign" onSelect={jest.fn()} disabled />,
    );

    expect(screen.getByText('Assign')).toBeDisabled();
  });
});
