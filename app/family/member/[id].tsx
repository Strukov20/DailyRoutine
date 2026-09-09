import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';

import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import {
  useFamilyMembers,
  useRemoveFamilyMember,
  useTransferFamilyOwnership,
  useUpdateChildProfile,
} from '@/domain/family/hooks';
import { useAuth } from '@/lib/auth/AuthProvider';
import { FamilyServiceError } from '@/lib/family/familyService';
import { createLogger } from '@/lib/logger/logger';
import { useAppTheme } from '@/theme';

const logger = createLogger('family-member-detail');

export default function FamilyMemberDetailScreen() {
  const { t } = useTranslation(['family', 'common']);
  const theme = useAppTheme();
  const router = useRouter();
  const { id, familyId } = useLocalSearchParams<{ id: string; familyId: string }>();
  const { profile } = useAuth();

  const membersQuery = useFamilyMembers(familyId);
  const removeMember = useRemoveFamilyMember(familyId);
  const updateChild = useUpdateChildProfile(familyId);
  const transferOwnership = useTransferFamilyOwnership(familyId);

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (membersQuery.isLoading) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: t('family:member.title') }} />
        <LoadingState />
      </ScreenContainer>
    );
  }

  const members = membersQuery.data ?? [];
  const member = members.find((m) => m.id === id);
  const caller = members.find((m) => m.profileId === profile?.id);
  const callerIsOwner = caller?.role === 'owner';

  if (!member) {
    return (
      <ScreenContainer>
        <Stack.Screen options={{ title: t('family:member.title') }} />
        <ErrorState title={t('family:member.notFound')} />
      </ScreenContainer>
    );
  }

  const isChild = member.memberType === 'child';
  const nameValue = displayName ?? member.displayName;

  const onSaveChild = async () => {
    setActionError(null);
    try {
      await updateChild.mutateAsync({ memberId: member.id, displayName: nameValue });
      router.back();
    } catch (error) {
      logger.warn('update child failed', {
        code: error instanceof FamilyServiceError ? error.code : 'unknown',
      });
      setActionError(t('common:state.somethingWentWrong'));
    }
  };

  const onMakeOwner = () => {
    Alert.alert(
      t('family:member.makeOwnerConfirm.title', { name: member.displayName }),
      t('family:member.makeOwnerConfirm.message', { name: member.displayName }),
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        {
          text: t('family:member.makeOwner'),
          onPress: () => {
            void transferOwnership
              .mutateAsync(member.id)
              .then(() => router.back())
              .catch((error: unknown) => {
                logger.warn('transfer ownership failed', {
                  code: error instanceof FamilyServiceError ? error.code : 'unknown',
                });
                setActionError(t('family:member.makeOwnerFailed'));
              });
          },
        },
      ],
    );
  };

  const onRemove = () => {
    Alert.alert(t('family:member.removeConfirm.title'), t('family:member.removeConfirm.message'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('family:member.remove'),
        style: 'destructive',
        onPress: () => {
          void removeMember
            .mutateAsync(member.id)
            .then(() => router.back())
            .catch((error: unknown) => {
              logger.warn('remove member failed', {
                code: error instanceof FamilyServiceError ? error.code : 'unknown',
              });
              setActionError(t('common:state.somethingWentWrong'));
            });
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <Stack.Screen options={{ title: member.displayName }} />

      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 16 }}>
        {t(`family:role.${member.role}`)}
      </Text>

      {isChild ? (
        <View style={styles.field}>
          <TextInput
            mode="outlined"
            label={t('family:addChild.nameField')}
            value={nameValue}
            onChangeText={setDisplayName}
          />
        </View>
      ) : null}

      <HelperText type="error" visible={Boolean(actionError)}>
        {actionError}
      </HelperText>

      {isChild ? (
        <Button
          mode="contained"
          onPress={() => void onSaveChild()}
          loading={updateChild.isPending}
          style={styles.action}
        >
          {t('common:actions.save')}
        </Button>
      ) : null}

      {callerIsOwner && member.role === 'adult' ? (
        <Button
          mode="outlined"
          onPress={onMakeOwner}
          loading={transferOwnership.isPending}
          style={styles.action}
        >
          {t('family:member.makeOwner')}
        </Button>
      ) : null}

      {callerIsOwner && member.role !== 'owner' ? (
        <Button
          mode="outlined"
          textColor={theme.colors.danger}
          onPress={onRemove}
          loading={removeMember.isPending}
          style={styles.action}
        >
          {t('family:member.remove')}
        </Button>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: 8,
  },
  action: {
    marginTop: 8,
  },
});
