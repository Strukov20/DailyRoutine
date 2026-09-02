import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, TextInput } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useCreateChildProfile } from '@/domain/family/hooks';
import { createChildProfileSchema, type CreateChildProfileInput } from '@/domain/family/schemas';
import { FamilyServiceError } from '@/lib/family/familyService';
import { createLogger } from '@/lib/logger/logger';

const logger = createLogger('family-add-child');

const FIELD_ERROR_MESSAGE_KEYS: Record<string, string> = {
  display_name_required: 'addChild.errors.nameRequired',
};

export default function AddChildScreen() {
  const { t } = useTranslation(['family', 'common']);
  const router = useRouter();
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const createChild = useCreateChildProfile(familyId);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateChildProfileInput>({
    resolver: zodResolver(createChildProfileSchema),
    defaultValues: { displayName: '', dateOfBirth: undefined },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await createChild.mutateAsync({
        displayName: values.displayName,
        dateOfBirth: values.dateOfBirth,
      });
      router.back();
    } catch (error) {
      logger.warn('add child failed', {
        code: error instanceof FamilyServiceError ? error.code : 'unknown',
      });
      setFormError(t('common:state.somethingWentWrong'));
    }
  });

  const errorMessage = (): string | undefined => {
    const key = errors.displayName?.message;
    return key ? t(`family:${FIELD_ERROR_MESSAGE_KEYS[key] ?? key}`) : undefined;
  };

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('family:addChild.title') }} />
      <Controller
        control={control}
        name="displayName"
        render={({ field }) => (
          <View style={styles.field}>
            <TextInput
              mode="outlined"
              label={t('family:addChild.nameField')}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={Boolean(errors.displayName)}
              autoFocus
            />
            <HelperText type="error" visible={Boolean(errors.displayName)}>
              {errorMessage()}
            </HelperText>
          </View>
        )}
      />

      <Controller
        control={control}
        name="dateOfBirth"
        render={({ field }) => (
          <View style={styles.field}>
            <TextInput
              mode="outlined"
              label={t('family:addChild.dateOfBirthField')}
              placeholder="YYYY-MM-DD"
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
            />
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
        {t('family:addChild.submit')}
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
