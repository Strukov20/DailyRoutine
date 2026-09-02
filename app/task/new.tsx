import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, useRouter } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { newTaskSchema, type NewTaskInput } from '@/domain/tasks/schemas';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('task-create');

/**
 * Preview of the "create task" entry point required by docs/PRODUCT.md
 * ("Task creation must be accessible from primary screens"). Only proves
 * the validated-form path (title is the sole required field, per
 * docs/DATA_MODEL.md) — persistence, scheduling, assignment, etc. are the
 * full task-CRUD phase, explicitly out of scope here (see docs/ROADMAP.md).
 */
export default function NewTaskModal() {
  const { t } = useTranslation(['tasks', 'common']);
  const router = useRouter();
  const theme = useAppTheme();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewTaskInput>({
    resolver: zodResolver(newTaskSchema),
    defaultValues: { title: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    logger.info('task creation submitted (not yet persisted)', {
      titleLength: values.title.length,
    });
    router.back();
  });

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('tasks:newTask.title') }} />
      <Controller
        control={control}
        name="title"
        render={({ field }) => (
          <View style={styles.field}>
            <TextInput
              mode="outlined"
              label={t('tasks:newTask.titleField')}
              placeholder={t('tasks:newTask.titlePlaceholder')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={Boolean(errors.title)}
              autoFocus
            />
            <HelperText type="error" visible={Boolean(errors.title)}>
              {errors.title ? t('tasks:newTask.titleRequired') : ''}
            </HelperText>
          </View>
        )}
      />

      <Button mode="contained" onPress={onSubmit} loading={isSubmitting} style={styles.submit}>
        {t('tasks:newTask.submit')}
      </Button>

      <Text style={[styles.notice, { color: theme.colors.onSurfaceVariant }]}>
        {t('tasks:newTask.persistenceNotice')}
      </Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  field: {
    marginTop: 8,
  },
  submit: {
    marginTop: 8,
  },
  notice: {
    marginTop: 16,
    fontSize: 12,
    textAlign: 'center',
  },
});
