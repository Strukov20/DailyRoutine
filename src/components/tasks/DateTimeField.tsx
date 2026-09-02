import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { HelperText, Icon, Text } from 'react-native-paper';

import { useAppTheme } from '@/theme';

interface DateTimeFieldProps {
  label: string;
  placeholder: string;
  mode: 'date' | 'time';
  /** The picked value, already in local time — never parsed through an ISO/UTC string. */
  value: Date | null;
  onChange: (date: Date) => void;
  onClear?: () => void;
  displayValue: string | null;
  error?: string;
}

/**
 * A single accessible date-or-time field backed by the platform's native
 * picker (@react-native-community/datetimepicker) — needs a native rebuild
 * to test on-device (see docs/DECISIONS.md, "Phase 4"). The caller owns
 * converting the resulting Date to/from a "YYYY-MM-DD"/"HH:MM" string (see
 * src/domain/tasks/dateUtils.ts) — this component only ever hands back a
 * Date it received from the native picker, never one it constructed itself
 * from a string.
 */
export function DateTimeField({
  label,
  placeholder,
  mode,
  value,
  onChange,
  onClear,
  displayValue,
  error,
}: DateTimeFieldProps) {
  const theme = useAppTheme();
  const [showPicker, setShowPicker] = useState(false);

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    // Android renders the picker as its own native dialog and reports
    // dismissal via event.type; iOS renders inline and stays open until the
    // caller closes it, so only Android needs to hide it here.
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    if (event.type === 'set' && selected) {
      onChange(selected);
    }
  };

  return (
    <View style={styles.container}>
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => setShowPicker(true)}
          style={[
            styles.field,
            { borderColor: error ? theme.colors.danger : theme.colors.outline },
          ]}
          accessibilityRole="button"
          accessibilityLabel={displayValue ?? placeholder}
        >
          <Icon source={mode === 'date' ? 'calendar' : 'clock-outline'} size={18} color={theme.colors.onSurfaceVariant} />
          <Text style={{ color: displayValue ? theme.colors.onSurface : theme.colors.onSurfaceVariant }}>
            {displayValue ?? placeholder}
          </Text>
        </Pressable>
        {onClear && displayValue ? (
          <Pressable onPress={onClear} hitSlop={8} style={styles.clear} accessibilityLabel={placeholder}>
            <Icon source="close-circle-outline" size={18} color={theme.colors.onSurfaceVariant} />
          </Pressable>
        ) : null}
      </View>
      <HelperText type="error" visible={Boolean(error)}>
        {error}
      </HelperText>
      {showPicker ? (
        <DateTimePicker
          value={value ?? new Date()}
          mode={mode}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleChange}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  clear: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
