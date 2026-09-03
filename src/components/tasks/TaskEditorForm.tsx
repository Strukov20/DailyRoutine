import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, HelperText, Menu, SegmentedButtons, Text, TextInput } from 'react-native-paper';

import { useCategories } from '@/domain/categories/hooks';
import type { Category } from '@/domain/categories/types';
import {
  formatDateOnly,
  formatTimeOnly,
  parseDateOnly,
  parseTimeOnly,
} from '@/domain/tasks/dateUtils';
import { useCreatePersonalTask, useSchedulePersonalTask, useUpdatePersonalTask } from '@/domain/tasks/hooks';
import { TASK_PRIORITIES } from '@/domain/tasks/priority';
import { taskEditorSchema, type TaskEditorInput } from '@/domain/tasks/schemas';
import { moveTaskToInbox, TaskServiceError } from '@/lib/tasks/taskService';
import { createLogger } from '@/lib/logger/logger';
import { useUIStore } from '@/store/uiStore';
import { useAppTheme } from '@/theme';

import { DateTimeField } from './DateTimeField';

const logger = createLogger('task-editor-form');

const DEVICE_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const FIELD_ERROR_MESSAGE_KEYS: Record<string, string> = {
  title_required: 'editor.errors.titleRequired',
  date_invalid: 'editor.errors.dateInvalid',
  time_invalid: 'editor.errors.timeInvalid',
  duration_invalid: 'editor.errors.durationInvalid',
  duration_too_long: 'editor.errors.durationTooLong',
  time_requires_date: 'editor.errors.timeRequiresDate',
  duration_requires_time: 'editor.errors.durationRequiresTime',
};

export interface TaskEditorInitialValues {
  title: string;
  description?: string;
  date?: string;
  startTime?: string;
  durationMinutes?: number;
  priority: TaskEditorInput['priority'];
  categoryId?: string;
  visibility: TaskEditorInput['visibility'];
}

interface TaskEditorFormProps {
  mode: 'create' | 'edit';
  /** Required for mode="edit". */
  taskId?: string;
  initialValues?: TaskEditorInitialValues;
  onDone: () => void;
}

/**
 * The reusable create/edit task form — app/task/new.tsx and
 * app/task/[id]/edit.tsx both render this. See docs/ARCHITECTURE.md,
 * "Layering": this component owns form state and validation only; the
 * actual mutation calls go through src/domain/tasks/hooks.ts.
 */
export function TaskEditorForm({ mode, taskId, initialValues, onDone }: TaskEditorFormProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const theme = useAppTheme();
  const navigation = useNavigation();
  const activeFamilyId = useUIStore((state) => state.activeFamilyId);
  const categoriesQuery = useCategories();
  const createTask = useCreatePersonalTask();
  const updateTask = useUpdatePersonalTask();
  const scheduleTask = useSchedulePersonalTask();
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting, isDirty, isSubmitSuccessful },
  } = useForm<TaskEditorInput>({
    resolver: zodResolver(taskEditorSchema),
    defaultValues: {
      title: initialValues?.title ?? '',
      description: initialValues?.description,
      date: initialValues?.date,
      startTime: initialValues?.startTime?.slice(0, 5),
      durationMinutes: initialValues?.durationMinutes,
      priority: initialValues?.priority ?? 'normal',
      categoryId: initialValues?.categoryId,
      visibility: initialValues?.visibility ?? 'private',
    },
  });

  // Unsaved-change confirmation: intercept the screen's own back navigation
  // (not just a Cancel button) whenever the form has unsaved edits.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!isDirty || isSubmitSuccessful) return;
      event.preventDefault();
      Alert.alert(t('tasks:editor.unsavedChanges.title'), t('tasks:editor.unsavedChanges.message'), [
        { text: t('common:actions.cancel'), style: 'cancel' },
        {
          text: t('tasks:editor.unsavedChanges.discard'),
          style: 'destructive',
          onPress: () => navigation.dispatch(event.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, isDirty, isSubmitSuccessful, t]);

  const dateValue = useWatch({ control, name: 'date' });
  const startTimeValue = useWatch({ control, name: 'startTime' });
  const visibilityValue = useWatch({ control, name: 'visibility' });
  const categoryIdValue = useWatch({ control, name: 'categoryId' });

  const categories = categoriesQuery.data ?? [];
  const selectedCategory = categories.find((category) => category.id === categoryIdValue);

  const onClearDate = () => {
    // "clearing the date clears or explicitly resolves time" — clearing the
    // date always clears the time too, so a time can never silently exist
    // without a date in the form's own state, mirroring the DB constraint.
    setValue('date', undefined, { shouldDirty: true });
    setValue('startTime', undefined, { shouldDirty: true });
    setValue('durationMinutes', undefined, { shouldDirty: true });
  };

  const onClearTime = () => {
    setValue('startTime', undefined, { shouldDirty: true });
    setValue('durationMinutes', undefined, { shouldDirty: true });
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (mode === 'create') {
        await createTask.mutateAsync({
          title: values.title,
          description: values.description,
          date: values.date,
          startTime: values.startTime,
          durationMinutes: values.durationMinutes,
          timezone: values.startTime ? DEVICE_TIMEZONE : undefined,
          priority: values.priority,
          categoryId: values.categoryId,
          visibility: values.visibility,
          familyId: values.visibility === 'family' ? (activeFamilyId ?? undefined) : undefined,
        });
      } else if (taskId) {
        await updateTask.mutateAsync({
          taskId,
          title: values.title,
          description: values.description,
          clearDescription: !values.description,
          priority: values.priority,
          categoryId: values.categoryId,
          clearCategory: !values.categoryId,
          visibility: values.visibility,
          familyId: values.visibility === 'family' ? (activeFamilyId ?? undefined) : undefined,
        });
        if (values.date) {
          await scheduleTask.mutateAsync({
            taskId,
            date: values.date,
            startTime: values.startTime,
            durationMinutes: values.durationMinutes,
            timezone: values.startTime ? DEVICE_TIMEZONE : undefined,
          });
        } else {
          await moveTaskToInbox(taskId);
        }
      }
      onDone();
    } catch (error) {
      const code = error instanceof TaskServiceError ? error.code : 'unknown';
      logger.warn('task save failed', { code, mode });
      setFormError(t('common:state.somethingWentWrong'));
    }
  });

  const fieldErrorMessage = (fieldName: keyof TaskEditorInput): string | undefined => {
    const key = errors[fieldName]?.message;
    return key ? t(`tasks:${FIELD_ERROR_MESSAGE_KEYS[key] ?? key}`) : undefined;
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <View style={styles.field}>
              <TextInput
                mode="outlined"
                label={t('tasks:editor.titleField')}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={Boolean(errors.title)}
                autoFocus={mode === 'create'}
              />
              <HelperText type="error" visible={Boolean(errors.title)}>
                {fieldErrorMessage('title')}
              </HelperText>
            </View>
          )}
        />

        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <View style={styles.field}>
              <TextInput
                mode="outlined"
                label={t('tasks:editor.descriptionField')}
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                multiline
                numberOfLines={3}
              />
            </View>
          )}
        />

        <DateTimeField
          label={t('tasks:editor.dateField')}
          placeholder={t('tasks:editor.dateNotSet')}
          mode="date"
          value={dateValue ? parseDateOnly(dateValue) : null}
          displayValue={dateValue ?? null}
          onChange={(date) => setValue('date', formatDateOnly(date), { shouldDirty: true })}
          onClear={onClearDate}
          error={fieldErrorMessage('date')}
        />

        {dateValue ? (
          <DateTimeField
            label={t('tasks:editor.timeField')}
            placeholder={t('tasks:editor.timeNotSet')}
            mode="time"
            value={startTimeValue ? parseTimeOnly(startTimeValue) : null}
            displayValue={startTimeValue ?? null}
            onChange={(date) => setValue('startTime', formatTimeOnly(date), { shouldDirty: true })}
            onClear={onClearTime}
            error={fieldErrorMessage('startTime')}
          />
        ) : null}

        {startTimeValue ? (
          <Controller
            control={control}
            name="durationMinutes"
            render={({ field }) => (
              <View style={styles.field}>
                <TextInput
                  mode="outlined"
                  label={t('tasks:editor.durationField')}
                  value={field.value ? String(field.value) : ''}
                  onChangeText={(text) => field.onChange(text ? Number(text) : undefined)}
                  onBlur={field.onBlur}
                  keyboardType="number-pad"
                  error={Boolean(errors.durationMinutes)}
                />
                <HelperText type="error" visible={Boolean(errors.durationMinutes)}>
                  {fieldErrorMessage('durationMinutes')}
                </HelperText>
              </View>
            )}
          />
        ) : null}

        <Divider style={styles.divider} />

        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('tasks:editor.priorityField')}
        </Text>
        <Controller
          control={control}
          name="priority"
          render={({ field }) => (
            <SegmentedButtons
              value={field.value}
              onValueChange={field.onChange}
              style={styles.segmented}
              buttons={TASK_PRIORITIES.map((priority) => ({
                value: priority,
                label: t(`common:priority.${priority}`),
              }))}
            />
          )}
        />

        <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
          {t('tasks:editor.visibilityField')}
        </Text>
        <Controller
          control={control}
          name="visibility"
          render={({ field }) => (
            <SegmentedButtons
              value={field.value}
              onValueChange={field.onChange}
              style={styles.segmented}
              buttons={[
                { value: 'private', label: t('tasks:editor.visibilityPrivate') },
                {
                  value: 'family',
                  label: t('tasks:editor.visibilityFamily'),
                  disabled: !activeFamilyId,
                },
              ]}
            />
          )}
        />
        {visibilityValue === 'family' && !activeFamilyId ? (
          <HelperText type="info" visible>
            {t('tasks:editor.visibilityFamilyUnavailable')}
          </HelperText>
        ) : null}

        <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
          {t('tasks:editor.categoryField')}
        </Text>
        <Menu
          visible={categoryMenuOpen}
          onDismiss={() => setCategoryMenuOpen(false)}
          anchor={
            <Button mode="outlined" onPress={() => setCategoryMenuOpen(true)} icon="chevron-down">
              {selectedCategory
                ? categoryLabel(selectedCategory, t)
                : t('tasks:editor.categoryNone')}
            </Button>
          }
        >
          <Menu.Item
            title={t('tasks:editor.categoryNone')}
            onPress={() => {
              setValue('categoryId', undefined, { shouldDirty: true });
              setCategoryMenuOpen(false);
            }}
          />
          <Divider />
          {categories.map((category) => (
            <Menu.Item
              key={category.id}
              title={categoryLabel(category, t)}
              onPress={() => {
                setValue('categoryId', category.id, { shouldDirty: true });
                setCategoryMenuOpen(false);
              }}
            />
          ))}
        </Menu>

        <HelperText type="error" visible={Boolean(formError)}>
          {formError}
        </HelperText>

        <Button
          mode="contained"
          onPress={() => void onSubmit()}
          loading={isSubmitting}
          disabled={isSubmitting}
          style={styles.submit}
        >
          {t(mode === 'create' ? 'tasks:editor.create' : 'tasks:editor.save')}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function categoryLabel(category: Category, t: (key: string) => string): string {
  const SYSTEM_TOKENS = ['work', 'family', 'home', 'shopping', 'health', 'other'];
  if (category.isSystem && SYSTEM_TOKENS.includes(category.colorToken)) {
    return t(`common:category.${category.colorToken}`);
  }
  return category.name;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingBottom: 48,
  },
  field: {
    marginTop: 4,
  },
  label: {
    marginTop: 16,
    marginBottom: 4,
  },
  segmented: {
    marginBottom: 4,
  },
  divider: {
    marginVertical: 16,
  },
  submit: {
    marginTop: 24,
  },
});
