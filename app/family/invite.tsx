import { zodResolver } from '@hookform/resolvers/zod';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useCreateFamilyInvitation } from '@/domain/family/hooks';
import { inviteMemberSchema, type InviteMemberInput } from '@/domain/family/schemas';
import { FamilyServiceError } from '@/lib/family/familyService';
import { makeInviteLink } from '@/lib/family/inviteLink';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('family-invite');

const FIELD_ERROR_MESSAGE_KEYS: Record<string, string> = {
  email_required: 'invite.errors.emailRequired',
  email_invalid: 'invite.errors.emailInvalid',
};

export default function InviteMemberScreen() {
  const { t } = useTranslation(['family', 'common']);
  const theme = useAppTheme();
  const { familyId } = useLocalSearchParams<{ familyId: string }>();
  const createInvitation = useCreateFamilyInvitation(familyId);
  const [formError, setFormError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteMemberInput>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setCopied(false);
    try {
      const result = await createInvitation.mutateAsync(values.email);
      setLink(makeInviteLink(result.token));
    } catch (error) {
      const code = error instanceof FamilyServiceError ? error.code : 'unknown';
      logger.warn('create invitation failed', { code });
      setFormError(
        code === 'forbidden'
          ? t('family:invite.errors.forbidden')
          : t('common:state.somethingWentWrong'),
      );
    }
  });

  const errorMessage = (): string | undefined => {
    const key = errors.email?.message;
    return key ? t(`family:${FIELD_ERROR_MESSAGE_KEYS[key] ?? key}`) : undefined;
  };

  const onShare = async () => {
    if (!link) return;
    await Share.share({ message: t('family:invite.shareMessage', { link }) });
  };

  const onCopy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
  };

  if (link) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: t('family:invite.title') }} />
        <View style={styles.linkSection}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('family:invite.linkReady')}
          </Text>
          <Text variant="bodyMedium" selectable style={styles.linkText}>
            {link}
          </Text>
          <Button mode="contained" onPress={() => void onShare()} style={styles.action}>
            {t('family:invite.share')}
          </Button>
          <Button mode="outlined" onPress={() => void onCopy()} style={styles.action}>
            {copied ? t('family:invite.copied') : t('family:invite.copyLink')}
          </Button>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: t('family:invite.title') }} />
      <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
        {t('family:invite.description')}
      </Text>
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <View style={styles.field}>
            <TextInput
              mode="outlined"
              label={t('family:invite.emailField')}
              autoCapitalize="none"
              keyboardType="email-address"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={Boolean(errors.email)}
              autoFocus
            />
            <HelperText type="error" visible={Boolean(errors.email)}>
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
        {t('family:invite.submit')}
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
  linkSection: {
    marginTop: 8,
  },
  linkText: {
    marginTop: 8,
    marginBottom: 16,
  },
  action: {
    marginBottom: 8,
  },
});
