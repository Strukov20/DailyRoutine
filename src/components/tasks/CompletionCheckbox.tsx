import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';
import { Icon } from 'react-native-paper';

import { useAppTheme } from '@/theme';

interface CompletionCheckboxProps {
  completed: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

/** A >=44x44 touch target regardless of the visible icon's own size (accessibility). */
export function CompletionCheckbox({ completed, onToggle, disabled = false }: CompletionCheckboxProps) {
  const { t } = useTranslation('tasks');
  const theme = useAppTheme();

  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: completed, disabled }}
      accessibilityLabel={completed ? t('row.markIncomplete') : t('row.markComplete')}
      hitSlop={8}
      style={[styles.target, disabled && styles.disabled]}
    >
      <Icon
        source={completed ? 'check-circle' : 'checkbox-blank-circle-outline'}
        size={24}
        color={completed ? theme.colors.success : theme.colors.onSurfaceVariant}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});
