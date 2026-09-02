import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import {
  useAcceptFamilyInvitation,
  useDeclineFamilyInvitation,
  useInvitationPreview,
} from '@/domain/family/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { FamilyServiceError } from '@/lib/family/familyService';
import { createLogger } from '@/lib/logger/logger';
import { useUIStore } from '@/store/uiStore';
import { useAppTheme } from '@/theme';

const logger = createLogger('invite-screen');

/**
 * Lands here from a shared invitation deep link
 * (familyflow://invite/<token>) — see src/lib/family/inviteLink.ts. A
 * top-level route (like app/reset-password.tsx, app/auth-callback.tsx),
 * outside both Stack.Protected groups in app/_layout.tsx, so it renders
 * regardless of auth status: signed-out visitors see a sign-in/sign-up
 * prompt (and their token is stashed in uiStore.pendingInviteToken so
 * app/_layout.tsx's redirect effect can bring them straight back here once
 * they're signed in); signed-in visitors see the sanitized preview and can
 * accept or decline immediately.
 */
export default function InviteScreen() {
  const { t } = useTranslation(['family', 'common']);
  const theme = useAppTheme();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { status } = useAuth();
  const setPendingInviteToken = useUIStore((state) => state.setPendingInviteToken);
  const [actionError, setActionError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  const previewQuery = useInvitationPreview(status === 'signed-in' ? (token ?? null) : null);
  const acceptMutation = useAcceptFamilyInvitation();
  const declineMutation = useDeclineFamilyInvitation();

  useEffect(() => {
    if (status === 'signed-out' && token) {
      setPendingInviteToken(token);
    }
  }, [status, token, setPendingInviteToken]);

  const onAccept = async () => {
    if (!token) return;
    setActionError(null);
    try {
      await acceptMutation.mutateAsync(token);
      setPendingInviteToken(null);
      router.replace('/(app)/family');
    } catch (error) {
      const code = error instanceof FamilyServiceError ? error.code : 'unknown';
      logger.warn('accept invitation failed', { code });
      setActionError(t('family:invite.errors.acceptFailed'));
    }
  };

  const onDecline = async () => {
    if (!token) return;
    setActionError(null);
    try {
      await declineMutation.mutateAsync(token);
      setPendingInviteToken(null);
      setDeclined(true);
    } catch (error) {
      const code = error instanceof FamilyServiceError ? error.code : 'unknown';
      logger.warn('decline invitation failed', { code });
      setActionError(t('family:invite.errors.declineFailed'));
    }
  };

  if (!token) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <ErrorState title={t('family:invite.notFound.title')} />
      </ScreenContainer>
    );
  }

  if (status === 'loading') {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (status === 'signed-out') {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
          <Text variant="headlineSmall">{t('family:invite.signedOut.title')}</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('family:invite.signedOut.description')}
          </Text>
          <Link href="/(auth)/sign-up" asChild>
            <Button mode="contained">{t('family:invite.signedOut.createAccount')}</Button>
          </Link>
          <Link href="/(auth)/sign-in" asChild>
            <Button mode="outlined">{t('family:invite.signedOut.signIn')}</Button>
          </Link>
        </View>
      </ScreenContainer>
    );
  }

  if (declined) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
          <Text variant="titleMedium" style={{ textAlign: 'center' }}>
            {t('family:invite.declined.title')}
          </Text>
          <Button mode="contained" onPress={() => router.replace('/(app)/today')}>
            {t('family:invite.declined.action')}
          </Button>
        </View>
      </ScreenContainer>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (previewQuery.isError || !previewQuery.data) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <ErrorState
          title={t('family:invite.notFound.title')}
          description={t('family:invite.notFound.description')}
        />
      </ScreenContainer>
    );
  }

  const preview = previewQuery.data;

  if (!preview.isValid) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
          <Text variant="titleMedium" style={{ textAlign: 'center' }}>
            {t('family:invite.noLongerValid.title')}
          </Text>
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
          >
            {t(`family:invite.status.${preview.status}`)}
          </Text>
          <Button mode="contained" onPress={() => router.replace('/(app)/today')}>
            {t('family:invite.declined.action')}
          </Button>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <Text variant="headlineSmall">
          {t('family:invite.preview.title', { familyName: preview.familyName })}
        </Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {t('family:invite.preview.description', { inviter: preview.invitedByDisplayName })}
        </Text>
        {actionError ? (
          <Text variant="bodySmall" style={{ color: theme.colors.danger }}>
            {actionError}
          </Text>
        ) : null}
        <Button
          mode="contained"
          onPress={() => void onAccept()}
          loading={acceptMutation.isPending}
          disabled={acceptMutation.isPending || declineMutation.isPending}
        >
          {t('family:invite.preview.accept')}
        </Button>
        <Button
          mode="outlined"
          onPress={() => void onDecline()}
          loading={declineMutation.isPending}
          disabled={acceptMutation.isPending || declineMutation.isPending}
        >
          {t('family:invite.preview.decline')}
        </Button>
      </View>
    </ScreenContainer>
  );
}
