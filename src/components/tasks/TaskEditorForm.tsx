import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  Dialog,
  Divider,
  HelperText,
  Menu,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';

import { useCategories, useCreateCustomCategory } from '@/domain/categories/hooks';
import type { Category } from '@/domain/categories/types';
import { useFamilyMembers } from '@/domain/family/hooks';
import {
  formatDateOnly,
  formatTimeOnly,
  parseDateOnly,
  parseTimeOnly,
} from '@/domain/tasks/dateUtils';
import {
  useCreatePersonalTask,
  useCreateSharedFamilyTask,
  useSchedulePersonalTask,
  useUpdatePersonalTask,
} from '@/domain/tasks/hooks';
import { TASK_PRIORITIES } from '@/domain/tasks/priority';
import { taskEditorSchema, type TaskEditorInput } from '@/domain/tasks/schemas';
import { useAuth } from '@/lib/auth/AuthProvider';
import { moveTaskToInbox, TaskServiceError } from '@/lib/tasks/taskService';
import { createLogger } from '@/lib/logger/logger';
import { useUIStore } from '@/store/uiStore';
import { categoryColors, useAppTheme } from '@/theme';

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
  /**
   * Set when this form is creating or editing a shared family task (Phase
   * 5, Section 10) — app/family/task/new.tsx, and app/task/[id]/edit.tsx
   * for a task whose visibility is already "family". Forces Family
   * visibility with no Private option (a shared task must never become
   * Private while still assigned — see the update_personal_task guard in
   * supabase/migrations/20260905120000_shared_family_tasks.sql), and in
   * create mode only, offers an optional Adult assignee (assignment is
   * otherwise a board action, not an edit-form field — reassigning an
   * existing task here would bypass the state-machine RPCs).
   */
  sharedFamilyId?: string;
}

/**
 * The reusable create/edit task form — app/task/new.tsx,
 * app/task/[id]/edit.tsx, and app/family/task/new.tsx all render this. See
 * docs/ARCHITECTURE.md, "Layering": this component owns form state and
 * validation only; the actual mutation calls go through
 * src/domain/tasks/hooks.ts.
 */
export function TaskEditorForm({
  mode,
  taskId,
  initialValues,
  onDone,
  sharedFamilyId,
}: TaskEditorFormProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const theme = useAppTheme();
  const navigation = useNavigation();
  const { profile } = useAuth();
  const activeFamilyId = useUIStore((state) => state.activeFamilyId);
  const categoriesQuery = useCategories();
  const familyMembersQuery = useFamilyMembers(sharedFamilyId ?? null);
  const createTask = useCreatePersonalTask();
  const createSharedTask = useCreateSharedFamilyTask(sharedFamilyId ?? '');
  const createCategory = useCreateCustomCategory();
  const updateTask = useUpdatePersonalTask();
  const scheduleTask = useSchedulePersonalTask();
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const [assigneeMemberId, setAssigneeMemberId] = useState<string | undefined>(undefined);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryToken, setNewCategoryToken] = useState<string>('work');
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);

  const familyMembers = familyMembersQuery.data ?? [];
  const activeFamilyMembers = familyMembers.filter((member) => !member.removedAt);
  const callerMember = familyMembers.find((member) => member.profileId === profile?.id);
  const canCreateCategory = Boolean(sharedFamilyId) && callerMember?.role === 'owner';
  const assignableMembers = activeFamilyMembers.filter((member) => member.memberType === 'adult');
  const selectedAssignee = assignableMembers.find((member) => member.id === assigneeMemberId);
  const isSelfAssignee = Boolean(
    selectedAssignee && callerMember && selectedAssignee.id === callerMember.id,
  );

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting, isDirty },
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
      visibility: sharedFamilyId ? 'family' : (initialValues?.visibility ?? 'private'),
    },
  });

  // Unsaved-change confirmation: intercept the screen's own back navigation
  // (not just a Cancel button) whenever the form has unsaved edits.
  //
  // `onDone()` below navigates away synchronously, in the same tick as a
  // successful mutation - before react-hook-form's own `isSubmitSuccessful`
  // state update has propagated through a re-render and this effect has
  // re-run to pick it up. Relying on `isSubmitSuccessful` here (via the
  // effect's dependency array) loses that race: `beforeRemove` fires
  // against a listener still closed over the pre-submit `isSubmitSuccessful
  // === false`, so it shows this dialog even though the save already
  // succeeded. A ref set synchronously the instant the mutation resolves -
  // read directly in the handler, no re-render required - closes the race.
  const justSubmittedRef = useRef(false);
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!isDirty || justSubmittedRef.current) return;
      event.preventDefault();
      Alert.alert(
        t('tasks:editor.unsavedChanges.title'),
        t('tasks:editor.unsavedChanges.message'),
        [
          { text: t('common:actions.cancel'), style: 'cancel' },
          {
            text: t('tasks:editor.unsavedChanges.discard'),
            style: 'destructive',
            onPress: () => navigation.dispatch(event.data.action),
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, isDirty, t]);

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

  // react-hooks/refs flags the ref write below as a possible during-render
  // access because it can't see through react-hook-form's `handleSubmit`
  // wrapper - this callback only ever runs as the form's submit event
  // handler (after a real submit), never during render.
  // eslint-disable-next-line react-hooks/refs
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (mode === 'create' && sharedFamilyId) {
        await createSharedTask.mutateAsync({
          title: values.title,
          description: values.description,
          date: values.date,
          startTime: values.startTime,
          durationMinutes: values.durationMinutes,
          timezone: values.startTime ? DEVICE_TIMEZONE : undefined,
          priority: values.priority,
          categoryId: values.categoryId,
          assigneeMemberId,
        });
      } else if (mode === 'create') {
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
          // A shared task's visibility/family are fixed — never let an edit
          // silently detach it or make it Private while still assigned
          // (update_personal_task rejects that server-side anyway; the
          // form just never offers the option in the first place).
          visibility: sharedFamilyId ? 'family' : values.visibility,
          familyId:
            sharedFamilyId ??
            (values.visibility === 'family' ? (activeFamilyId ?? undefined) : undefined),
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
      justSubmittedRef.current = true;
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

  const handleCreateCategory = async () => {
    if (!sharedFamilyId || newCategoryName.trim().length === 0) return;
    setNewCategoryError(null);
    try {
      const id = await createCategory.mutateAsync({
        familyId: sharedFamilyId,
        name: newCategoryName.trim(),
        colorToken: newCategoryToken,
      });
      setValue('categoryId', id, { shouldDirty: true });
      setNewCategoryOpen(false);
      setNewCategoryName('');
    } catch {
      setNewCategoryError(t('tasks:editor.newCategoryError'));
    }
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
                testID="task-editor-title"
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

        {sharedFamilyId ? (
          <HelperText type="info" visible style={styles.sharedNotice}>
            {t('tasks:editor.sharedFamilyNotice')}
          </HelperText>
        ) : (
          <>
            <Text
              variant="labelMedium"
              style={[styles.label, { color: theme.colors.onSurfaceVariant }]}
            >
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
          </>
        )}

        {mode === 'create' && sharedFamilyId ? (
          <>
            <Text
              variant="labelMedium"
              style={[styles.label, { color: theme.colors.onSurfaceVariant }]}
            >
              {t('tasks:editor.assigneeField')}
            </Text>
            <Menu
              visible={assigneeMenuOpen}
              onDismiss={() => setAssigneeMenuOpen(false)}
              anchor={
                <Button
                  mode="outlined"
                  onPress={() => setAssigneeMenuOpen(true)}
                  icon="account-arrow-right-outline"
                >
                  {selectedAssignee ? selectedAssignee.displayName : t('tasks:editor.assigneeNone')}
                </Button>
              }
            >
              <Menu.Item
                title={t('tasks:editor.assigneeNone')}
                onPress={() => {
                  setAssigneeMemberId(undefined);
                  setAssigneeMenuOpen(false);
                }}
              />
              <Divider />
              {assignableMembers.map((member) => (
                <Menu.Item
                  key={member.id}
                  title={member.displayName}
                  onPress={() => {
                    setAssigneeMemberId(member.id);
                    setAssigneeMenuOpen(false);
                  }}
                />
              ))}
            </Menu>
            {selectedAssignee && !isSelfAssignee ? (
              <HelperText type="info" visible>
                {t('tasks:editor.assigneeConfirmationNotice', {
                  name: selectedAssignee.displayName,
                })}
              </HelperText>
            ) : null}
          </>
        ) : null}

        <Text
          variant="labelMedium"
          style={[styles.label, { color: theme.colors.onSurfaceVariant }]}
        >
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
          {canCreateCategory ? (
            <>
              <Divider />
              <Menu.Item
                title={t('tasks:editor.newCategory')}
                leadingIcon="plus"
                onPress={() => {
                  setCategoryMenuOpen(false);
                  setNewCategoryOpen(true);
                }}
              />
            </>
          ) : null}
        </Menu>

        <HelperText type="error" visible={Boolean(formError)}>
          {formError}
        </HelperText>

        <Button
          testID="task-editor-submit"
          mode="contained"
          onPress={() => void onSubmit()}
          loading={isSubmitting}
          disabled={isSubmitting}
          style={styles.submit}
        >
          {t(mode === 'create' ? 'tasks:editor.create' : 'tasks:editor.save')}
        </Button>
      </ScrollView>

      {canCreateCategory ? (
        <Portal>
          <Dialog visible={newCategoryOpen} onDismiss={() => setNewCategoryOpen(false)}>
            <Dialog.Title>{t('tasks:editor.newCategoryTitle')}</Dialog.Title>
            <Dialog.Content>
              <TextInput
                mode="outlined"
                label={t('tasks:editor.newCategoryNameField')}
                value={newCategoryName}
                onChangeText={setNewCategoryName}
              />
              <View style={styles.swatchRow}>
                {Object.entries(categoryColors).map(([token, color]) => (
                  <Pressable
                    key={token}
                    accessibilityLabel={token}
                    onPress={() => setNewCategoryToken(token)}
                    style={[
                      styles.swatch,
                      { backgroundColor: color },
                      newCategoryToken === token && [
                        styles.swatchSelected,
                        { borderColor: theme.colors.primary },
                      ],
                    ]}
                  />
                ))}
              </View>
              <HelperText type="error" visible={Boolean(newCategoryError)}>
                {newCategoryError}
              </HelperText>
            </Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => setNewCategoryOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                onPress={() => void handleCreateCategory()}
                loading={createCategory.isPending}
                disabled={newCategoryName.trim().length === 0 || createCategory.isPending}
              >
                {t('common:actions.create')}
              </Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>
      ) : null}
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
  sharedNotice: {
    marginTop: 4,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderWidth: 2,
  },
});
