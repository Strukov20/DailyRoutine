import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, HelperText, Menu, SegmentedButtons, Text, TextInput } from 'react-native-paper';

import { getDeviceTimeZone } from '@/domain/calendar/dateUtils';
import {
  useCreateChildEvent,
  useCreateFamilyEvent,
  useCreatePersonalEvent,
  useScheduleConflict,
  useUpdateEvent,
} from '@/domain/calendar/hooks';
import { eventEditorSchema, type EventEditorInput, type EventKind } from '@/domain/calendar/schemas';
import { useFamilyMembers } from '@/domain/family/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { CalendarServiceError } from '@/lib/calendar/calendarService';
import { createLogger } from '@/lib/logger/logger';
import { useUIStore } from '@/store/uiStore';
import { useAppTheme } from '@/theme';

import { DateTimeField } from '../tasks/DateTimeField';

const logger = createLogger('event-editor-form');

const FIELD_ERROR_MESSAGE_KEYS: Record<string, string> = {
  title_required: 'editor.errors.titleRequired',
  date_invalid: 'editor.errors.dateInvalid',
  time_invalid: 'editor.errors.timeInvalid',
  end_before_start: 'editor.errors.endBeforeStart',
  family_required: 'editor.errors.familyRequired',
  child_required: 'editor.errors.childRequired',
};

export interface EventEditorInitialValues {
  kind: EventKind;
  title: string;
  description?: string;
  location?: string;
  date: string;
  startTime: string;
  endTime: string;
  visibility?: 'private' | 'family';
  familyId?: string;
  childMemberId?: string;
}

interface EventEditorFormProps {
  mode: 'create' | 'edit';
  /** Required for mode="edit". */
  eventId?: string;
  initialValues?: EventEditorInitialValues;
  onDone: () => void;
  /** Pre-selected family — e.g. reached from the Family day view. */
  defaultFamilyId?: string | null;
}

function toIsoInstant(date: string, time: string): string {
  const dateParts = date.split('-').map(Number);
  const timeParts = time.split(':').map(Number);
  const [year, month, day] = [dateParts[0] ?? 1970, dateParts[1] ?? 1, dateParts[2] ?? 1];
  const [hours, minutes] = [timeParts[0] ?? 0, timeParts[1] ?? 0];
  return new Date(year, month - 1, day, hours, minutes).toISOString();
}

/**
 * The single reusable event editor — app/event/new.tsx and
 * app/event/[id]/edit.tsx both render this, mirroring
 * src/components/tasks/TaskEditorForm.tsx's established pattern. Owns form
 * state/validation only; mutations go through src/domain/calendar/hooks.ts.
 * The MVP Day Calendar has no all-day/date-only event concept — date +
 * start + end are always required (see docs/DECISIONS.md, "Phase 7").
 */
export function EventEditorForm({ mode, eventId, initialValues, onDone, defaultFamilyId }: EventEditorFormProps) {
  const { t } = useTranslation(['calendar', 'common']);
  const theme = useAppTheme();
  const navigation = useNavigation();
  const { profile } = useAuth();
  const activeFamilyId = useUIStore((state) => state.activeFamilyId);
  const familyId = initialValues?.familyId ?? defaultFamilyId ?? activeFamilyId ?? undefined;
  const familyMembersQuery = useFamilyMembers(familyId ?? null);
  const createPersonalEvent = useCreatePersonalEvent();
  const createFamilyEvent = useCreateFamilyEvent(familyId ?? '');
  const createChildEvent = useCreateChildEvent(familyId ?? '');
  const updateEvent = useUpdateEvent(familyId);
  const [formError, setFormError] = useState<string | null>(null);
  const [childMenuOpen, setChildMenuOpen] = useState(false);
  const [dropOffMenuOpen, setDropOffMenuOpen] = useState(false);
  const [pickUpMenuOpen, setPickUpMenuOpen] = useState(false);

  const familyMembers = (familyMembersQuery.data ?? []).filter((member) => !member.removedAt);
  const children = familyMembers.filter((member) => member.memberType === 'child');
  const adults = familyMembers.filter((member) => member.memberType === 'adult');
  const callerMember = familyMembers.find((member) => member.profileId === profile?.id);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EventEditorInput>({
    resolver: zodResolver(eventEditorSchema),
    defaultValues: {
      kind: initialValues?.kind ?? (familyId ? 'family' : 'personal'),
      title: initialValues?.title ?? '',
      description: initialValues?.description,
      location: initialValues?.location,
      date: initialValues?.date,
      startTime: initialValues?.startTime,
      endTime: initialValues?.endTime,
      visibility: initialValues?.visibility ?? 'private',
      familyId,
      childMemberId: initialValues?.childMemberId,
      dropOffAssigneeMemberId: undefined,
      pickUpAssigneeMemberId: undefined,
    },
  });

  const justSubmittedRef = useRef(false);
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!isDirty || justSubmittedRef.current) return;
      event.preventDefault();
      Alert.alert(
        t('calendar:editor.unsavedChanges.title'),
        t('calendar:editor.unsavedChanges.message'),
        [
          { text: t('common:actions.cancel'), style: 'cancel' },
          {
            text: t('calendar:editor.unsavedChanges.discard'),
            style: 'destructive',
            onPress: () => navigation.dispatch(event.data.action),
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, isDirty, t]);

  const kindValue = useWatch({ control, name: 'kind' });
  const dateValue = useWatch({ control, name: 'date' });
  const startTimeValue = useWatch({ control, name: 'startTime' });
  const endTimeValue = useWatch({ control, name: 'endTime' });
  const childMemberIdValue = useWatch({ control, name: 'childMemberId' });
  const dropOffAssigneeValue = useWatch({ control, name: 'dropOffAssigneeMemberId' });
  const pickUpAssigneeValue = useWatch({ control, name: 'pickUpAssigneeMemberId' });

  const rangeReady = Boolean(dateValue && startTimeValue && endTimeValue && endTimeValue > startTimeValue);
  const startInstant = rangeReady ? toIsoInstant(dateValue, startTimeValue) : null;
  const endInstant = rangeReady ? toIsoInstant(dateValue, endTimeValue) : null;

  const dropOffConflict = useScheduleConflict(dropOffAssigneeValue ?? null, startInstant, startInstant);
  const pickUpConflict = useScheduleConflict(pickUpAssigneeValue ?? null, endInstant, endInstant);

  const selectedChild = children.find((member) => member.id === childMemberIdValue);
  const selectedDropOff = adults.find((member) => member.id === dropOffAssigneeValue);
  const selectedPickUp = adults.find((member) => member.id === pickUpAssigneeValue);

  // eslint-disable-next-line react-hooks/refs
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const startsAt = toIsoInstant(values.date, values.startTime);
    const endsAt = toIsoInstant(values.date, values.endTime);
    const timezone = getDeviceTimeZone();
    try {
      if (mode === 'create' && values.kind === 'child' && values.familyId && values.childMemberId) {
        await createChildEvent.mutateAsync({
          childMemberId: values.childMemberId,
          title: values.title,
          startsAt,
          endsAt,
          timezone,
          description: values.description,
          location: values.location,
          dropOffAssigneeMemberId: values.dropOffAssigneeMemberId,
          pickUpAssigneeMemberId: values.pickUpAssigneeMemberId,
        });
      } else if (mode === 'create' && values.kind === 'family' && values.familyId) {
        await createFamilyEvent.mutateAsync({
          title: values.title,
          startsAt,
          endsAt,
          timezone,
          description: values.description,
          location: values.location,
        });
      } else if (mode === 'create') {
        await createPersonalEvent.mutateAsync({
          title: values.title,
          startsAt,
          endsAt,
          timezone,
          description: values.description,
          location: values.location,
          visibility: values.visibility,
          familyId: values.visibility === 'family' ? values.familyId : undefined,
        });
      } else if (eventId) {
        await updateEvent.mutateAsync({
          eventId,
          title: values.title,
          description: values.description,
          clearDescription: !values.description,
          location: values.location,
          clearLocation: !values.location,
          startsAt,
          endsAt,
          timezone,
          visibility: values.kind === 'personal' ? values.visibility : undefined,
        });
      }
      justSubmittedRef.current = true;
      onDone();
    } catch (error) {
      const code = error instanceof CalendarServiceError ? error.code : 'unknown';
      logger.warn('event save failed', { code, mode });
      setFormError(t('common:state.somethingWentWrong'));
    }
  });

  const fieldErrorMessage = (fieldName: keyof EventEditorInput): string | undefined => {
    const key = errors[fieldName]?.message;
    return key ? t(`calendar:${FIELD_ERROR_MESSAGE_KEYS[key] ?? key}`) : undefined;
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {mode === 'create' ? (
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <SegmentedButtons
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  setValue('familyId', value === 'personal' ? undefined : familyId, { shouldDirty: true });
                }}
                style={styles.segmented}
                buttons={[
                  { value: 'personal', label: t('calendar:editor.kindPersonal') },
                  { value: 'family', label: t('calendar:editor.kindFamily'), disabled: !familyId },
                  { value: 'child', label: t('calendar:editor.kindChild'), disabled: !familyId },
                ]}
              />
            )}
          />
        ) : null}

        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <View style={styles.field}>
              <TextInput
                testID="event-editor-title"
                mode="outlined"
                label={t('calendar:editor.titleField')}
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
            <TextInput
              mode="outlined"
              label={t('calendar:editor.descriptionField')}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              multiline
              numberOfLines={3}
              style={styles.field}
            />
          )}
        />

        <Controller
          control={control}
          name="location"
          render={({ field }) => (
            <TextInput
              mode="outlined"
              label={t('calendar:editor.locationField')}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              style={styles.field}
            />
          )}
        />

        <DateTimeField
          label={t('calendar:editor.dateField')}
          placeholder={t('calendar:editor.dateField')}
          mode="date"
          value={dateValue ? new Date(dateValue) : null}
          displayValue={dateValue ?? null}
          onChange={(date) =>
            setValue('date', `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, {
              shouldDirty: true,
            })
          }
          error={fieldErrorMessage('date')}
        />

        <DateTimeField
          label={t('calendar:editor.startTimeField')}
          placeholder={t('calendar:editor.startTimeField')}
          mode="time"
          value={startTimeValue ? new Date(`2000-01-01T${startTimeValue}:00`) : null}
          displayValue={startTimeValue ?? null}
          onChange={(date) =>
            setValue('startTime', `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`, {
              shouldDirty: true,
            })
          }
          error={fieldErrorMessage('startTime')}
        />

        <DateTimeField
          label={t('calendar:editor.endTimeField')}
          placeholder={t('calendar:editor.endTimeField')}
          mode="time"
          value={endTimeValue ? new Date(`2000-01-01T${endTimeValue}:00`) : null}
          displayValue={endTimeValue ?? null}
          onChange={(date) =>
            setValue('endTime', `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`, {
              shouldDirty: true,
            })
          }
          error={fieldErrorMessage('endTime')}
        />

        {kindValue === 'personal' ? (
          <>
            <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
              {t('calendar:editor.visibilityField')}
            </Text>
            <Controller
              control={control}
              name="visibility"
              render={({ field }) => (
                <SegmentedButtons
                  value={field.value ?? 'private'}
                  onValueChange={field.onChange}
                  style={styles.segmented}
                  buttons={[
                    { value: 'private', label: t('calendar:editor.visibilityPrivate') },
                    { value: 'family', label: t('calendar:editor.visibilityFamily'), disabled: !familyId },
                  ]}
                />
              )}
            />
          </>
        ) : null}

        {kindValue === 'child' && mode === 'create' ? (
          <>
            <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
              {t('calendar:editor.childField')}
            </Text>
            <Menu
              visible={childMenuOpen}
              onDismiss={() => setChildMenuOpen(false)}
              anchor={
                <Button testID="event-editor-child" mode="outlined" onPress={() => setChildMenuOpen(true)} icon="account-child-outline">
                  {selectedChild ? selectedChild.displayName : t('calendar:editor.childNone')}
                </Button>
              }
            >
              {children.map((member) => (
                <Menu.Item
                  key={member.id}
                  title={member.displayName}
                  onPress={() => {
                    setValue('childMemberId', member.id, { shouldDirty: true });
                    setChildMenuOpen(false);
                  }}
                />
              ))}
            </Menu>
            <HelperText type="error" visible={Boolean(errors.childMemberId)}>
              {fieldErrorMessage('childMemberId')}
            </HelperText>

            <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
              {t('calendar:editor.dropOffField')}
            </Text>
            <Menu
              visible={dropOffMenuOpen}
              onDismiss={() => setDropOffMenuOpen(false)}
              anchor={
                <Button mode="outlined" onPress={() => setDropOffMenuOpen(true)} icon="account-arrow-right-outline">
                  {selectedDropOff ? selectedDropOff.displayName : t('calendar:editor.assigneeNone')}
                </Button>
              }
            >
              <Menu.Item
                title={t('calendar:editor.assigneeNone')}
                onPress={() => {
                  setValue('dropOffAssigneeMemberId', undefined, { shouldDirty: true });
                  setDropOffMenuOpen(false);
                }}
              />
              <Divider />
              {adults.map((member) => (
                <Menu.Item
                  key={member.id}
                  title={member.displayName}
                  onPress={() => {
                    setValue('dropOffAssigneeMemberId', member.id, { shouldDirty: true });
                    setDropOffMenuOpen(false);
                  }}
                />
              ))}
            </Menu>
            {selectedDropOff && callerMember && selectedDropOff.id !== callerMember.id ? (
              <HelperText type="info" visible>
                {t('calendar:editor.assigneeConfirmationNotice', { name: selectedDropOff.displayName })}
              </HelperText>
            ) : null}
            {dropOffConflict.data ? (
              <HelperText type="error" visible>
                {t('calendar:editor.conflictWarning', { name: selectedDropOff?.displayName ?? '' })}
              </HelperText>
            ) : null}

            <Text variant="labelMedium" style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
              {t('calendar:editor.pickUpField')}
            </Text>
            <Menu
              visible={pickUpMenuOpen}
              onDismiss={() => setPickUpMenuOpen(false)}
              anchor={
                <Button mode="outlined" onPress={() => setPickUpMenuOpen(true)} icon="account-arrow-right-outline">
                  {selectedPickUp ? selectedPickUp.displayName : t('calendar:editor.assigneeNone')}
                </Button>
              }
            >
              <Menu.Item
                title={t('calendar:editor.assigneeNone')}
                onPress={() => {
                  setValue('pickUpAssigneeMemberId', undefined, { shouldDirty: true });
                  setPickUpMenuOpen(false);
                }}
              />
              <Divider />
              {adults.map((member) => (
                <Menu.Item
                  key={member.id}
                  title={member.displayName}
                  onPress={() => {
                    setValue('pickUpAssigneeMemberId', member.id, { shouldDirty: true });
                    setPickUpMenuOpen(false);
                  }}
                />
              ))}
            </Menu>
            {selectedPickUp && callerMember && selectedPickUp.id !== callerMember.id ? (
              <HelperText type="info" visible>
                {t('calendar:editor.assigneeConfirmationNotice', { name: selectedPickUp.displayName })}
              </HelperText>
            ) : null}
            {pickUpConflict.data ? (
              <HelperText type="error" visible>
                {t('calendar:editor.conflictWarning', { name: selectedPickUp?.displayName ?? '' })}
              </HelperText>
            ) : null}
          </>
        ) : null}

        <HelperText type="error" visible={Boolean(formError)}>
          {formError}
        </HelperText>

        <Button
          testID="event-editor-submit"
          mode="contained"
          onPress={() => void onSubmit()}
          loading={isSubmitting}
          disabled={isSubmitting}
          style={styles.submit}
        >
          {t(mode === 'create' ? 'calendar:editor.create' : 'calendar:editor.save')}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: 48 },
  field: { marginTop: 4 },
  label: { marginTop: 16, marginBottom: 4 },
  segmented: { marginBottom: 4 },
  submit: { marginTop: 24 },
});
