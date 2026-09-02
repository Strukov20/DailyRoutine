import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, TextInput } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { createFamilySchema, type CreateFamilyInput } from '@/domain/family/schemas';
import { useCreateFamily } from '@/domain/family/hooks';
import { FamilyServiceError } from '@/lib/family/familyService';
import { createLogger } from '@/lib/logger/logger';
import { useUIStore } from '@/store/uiStore';

const logger = createLogger('family-create');

const FIELD_ERROR_MESSAGE_KEYS: Record<string, string> = {
  name_required: 'create.errors.nameRequired',
};

export default function CreateFamilyScreen() {
  const { t } = useTranslation(['family', 'common']);
  const router = useRouter();
  const setActiveFamilyId = useUIStore((state) => state.setActiveFamilyId);
  const createFamily = useCreateFamily();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateFamilyInput>({
    resolver: zodResolver(createFamilySchema),
    defaultValues: { name: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await createFamily.mutateAsync(values.name);
      setActiveFamilyId(result.familyId);
      router.back();
    } catch (error) {
      logger.warn('create family failed', {
        code: error instanceof FamilyServiceError ? error.code : 'unknown',
      });
      setFormError(t('common:state.somethingWentWrong'));
    }
  });

  const errorMessage = (): string | undefined => {
    const key = errors.name?.message;
    return key ? t(`family:${FIELD_ERROR_MESSAGE_KEYS[key] ?? key}`) : undefined;
  };

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('family:create.title') }} />
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <View style={styles.field}>
            <TextInput
              mode="outlined"
              label={t('family:create.nameField')}
              placeholder={t('family:create.namePlaceholder')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={Boolean(errors.name)}
              autoFocus
            />
            <HelperText type="error" visible={Boolean(errors.name)}>
              {errorMessage()}
            </HelperText>
          </View>
        )}
      />

      <HelperText type="error" visible={Boolean(formError)}>
        {formError}
      </HelperText>

      <Button
        mode="contained"
        onPress={() => void onSubmit()}
        loading={isSubmitting}
        style={styles.submit}
      >
        {t('family:create.submit')}
      </Button>
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
});
