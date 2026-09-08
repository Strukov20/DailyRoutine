import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Chip, HelperText, SegmentedButtons, Text, TextInput } from 'react-native-paper';

import type { RecurrenceFrequency } from '@/domain/recurrence/types';
import { useAppTheme } from '@/theme';

import { DateTimeField } from './DateTimeField';

export type EndCondition = 'never' | 'on_date' | 'after_count';

export interface RecurrenceState {
  frequency: RecurrenceFrequency | 'none';
  interval: number;
  byWeekday: number[];
  endCondition: EndCondition;
  until?: string;
  count?: number;
}

interface RecurrencePickerProps {
  value: RecurrenceState;
  onChange: (value: RecurrenceState) => void;
  errors?: { byWeekday?: string; until?: string; count?: string };
}

const WEEKDAYS: { value: number; labelKey: string }[] = [
  { value: 1, labelKey: 'recurrence.weekdayMon' },
  { value: 2, labelKey: 'recurrence.weekdayTue' },
  { value: 3, labelKey: 'recurrence.weekdayWed' },
  { value: 4, labelKey: 'recurrence.weekdayThu' },
  { value: 5, labelKey: 'recurrence.weekdayFri' },
  { value: 6, labelKey: 'recurrence.weekdaySat' },
  { value: 0, labelKey: 'recurrence.weekdaySun' },
];

/**
 * The "Repeat" section of the task editor (Section 13). Purely
 * presentational/controlled — no hooks calling any service directly, same
 * convention as every other *Picker/*Field in this directory. Timezone is
 * never a field here — the device's own IANA zone is captured by the
 * caller at submit time (see TaskEditorForm), matching how startTime's
 * timezone is already handled.
 */
export function RecurrencePicker({ value, onChange, errors }: RecurrencePickerProps) {
  const { t } = useTranslation('tasks');
  const theme = useAppTheme();

  const toggleWeekday = (day: number) => {
    const next = value.byWeekday.includes(day)
      ? value.byWeekday.filter((d) => d !== day)
      : [...value.byWeekday, day];
    onChange({ ...value, byWeekday: next });
  };

  return (
    <View>
      <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
        {t('recurrence.repeatField')}
      </Text>
      <SegmentedButtons
        value={value.frequency}
        onValueChange={(v) => onChange({ ...value, frequency: v as RecurrenceState['frequency'] })}
        style={styles.segmented}
        buttons={[
          { value: 'none', label: t('recurrence.repeatNone') },
          { value: 'daily', label: t('recurrence.repeatDaily') },
          { value: 'weekly', label: t('recurrence.repeatWeekly') },
          { value: 'monthly', label: t('recurrence.repeatMonthly') },
          { value: 'yearly', label: t('recurrence.repeatYearly') },
        ]}
      />

      {value.frequency !== 'none' ? (
        <>
          <View style={styles.intervalRow}>
            <Text variant="bodyMedium">{t('recurrence.everyLabel')}</Text>
            <TextInput
              testID="recurrence-interval"
              mode="outlined"
              dense
              style={styles.intervalInput}
              keyboardType="number-pad"
              value={String(value.interval)}
              onChangeText={(text) => {
                const n = Number(text);
                onChange({ ...value, interval: Number.isFinite(n) && n > 0 ? n : 1 });
              }}
            />
            <Text variant="bodyMedium">{t(`recurrence.unit_${value.frequency}`)}</Text>
          </View>

          {value.frequency === 'weekly' ? (
            <>
              <View style={styles.weekdayRow}>
                {WEEKDAYS.map((day) => (
                  <Chip
                    key={day.value}
                    testID={`recurrence-weekday-${day.value}`}
                    selected={value.byWeekday.includes(day.value)}
                    onPress={() => toggleWeekday(day.value)}
                    compact
                    style={styles.weekdayChip}
                  >
                    {t(day.labelKey)}
                  </Chip>
                ))}
              </View>
              <HelperText type="error" visible={Boolean(errors?.byWeekday)}>
                {errors?.byWeekday}
              </HelperText>
            </>
          ) : null}

          <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
            {t('recurrence.endsField')}
          </Text>
          <SegmentedButtons
            value={value.endCondition}
            onValueChange={(v) => onChange({ ...value, endCondition: v as EndCondition })}
            style={styles.segmented}
            buttons={[
              { value: 'never', label: t('recurrence.endsNever') },
              { value: 'on_date', label: t('recurrence.endsOnDate') },
              { value: 'after_count', label: t('recurrence.endsAfterCount') },
            ]}
          />

          {value.endCondition === 'on_date' ? (
            <>
              <DateTimeField
                label={t('recurrence.untilField')}
                placeholder={t('recurrence.untilField')}
                mode="date"
                value={value.until ? new Date(value.until) : null}
                displayValue={value.until ?? null}
                onChange={(date) =>
                  onChange({
                    ...value,
                    until: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
                  })
                }
                error={errors?.until}
              />
            </>
          ) : null}

          {value.endCondition === 'after_count' ? (
            <View style={styles.field}>
              <TextInput
                testID="recurrence-count"
                mode="outlined"
                label={t('recurrence.countField')}
                keyboardType="number-pad"
                value={value.count ? String(value.count) : ''}
                onChangeText={(text) => {
                  const n = Number(text);
                  onChange({ ...value, count: text && Number.isFinite(n) && n > 0 ? n : undefined });
                }}
              />
              <HelperText type="error" visible={Boolean(errors?.count)}>
                {errors?.count}
              </HelperText>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 16, marginBottom: 4 },
  segmented: { marginBottom: 4 },
  intervalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  intervalInput: {
    width: 64,
  },
  weekdayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  weekdayChip: {
    marginBottom: 0,
  },
  field: {
    marginTop: 4,
  },
});
