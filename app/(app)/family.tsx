import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Chip, Divider, List, Menu, SegmentedButtons, Text } from 'react-native-paper';
import { useState } from 'react';

import { FamilyTaskBoard } from '@/components/tasks/FamilyTaskBoard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { ScreenContainer } from '@/components/ui/ScreenContainer';
import { useActiveFamily, useFamilyInvitations, useFamilyMembers } from '@/domain/family/hooks';
import type { FamilyMember } from '@/domain/family/types';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useUIStore } from '@/store/uiStore';
import { useAppTheme } from '@/theme';

/**
 * The Family Space screen: family switcher (a user may belong to several
 * families — TanStack Query is the source of truth for the list, Zustand
 * only remembers which one is selected, see src/domain/family/hooks.ts's
 * useActiveFamily), the member roster, and entry points into invite /
 * add-child / member-detail (app/family/*.tsx). See docs/ARCHITECTURE.md.
 */
export default function FamilyScreen() {
  const { t } = useTranslation(['family', 'common']);
  const theme = useAppTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const setActiveFamilyId = useUIStore((state) => state.setActiveFamilyId);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [view, setView] = useState<'members' | 'tasks'>('members');

  const { families, activeFamily, isLoading, isError } = useActiveFamily();
  const membersQuery = useFamilyMembers(activeFamily?.id ?? null);
  const invitationsQuery = useFamilyInvitations(activeFamily?.id ?? null);

  if (isLoading) {
    return (
      <ScreenContainer>
        <LoadingState />
      </ScreenContainer>
    );
  }

  if (isError) {
    return (
      <ScreenContainer>
        <ErrorState />
      </ScreenContainer>
    );
  }

  if (!activeFamily) {
    return (
      <ScreenContainer>
        <Text variant="headlineSmall" style={styles.title}>
          {t('family:title')}
        </Text>
        <EmptyState
          title={t('family:emptyTitle')}
          description={t('family:emptyDescription')}
          actionLabel={t('family:createFamily')}
          onAction={() => router.push('/family/create')}
        />
      </ScreenContainer>
    );
  }

  const members = membersQuery.data ?? [];
  const caller = members.find((m) => m.profileId === profile?.id);
  const callerIsOwner = caller?.role === 'owner';
  const invitations = (invitationsQuery.data ?? []).filter((inv) => inv.status === 'pending');

  const renderMember = ({ item }: { item: FamilyMember }) => (
    <List.Item
      title={item.displayName}
      description={t(`family:role.${item.role}`)}
      onPress={() =>
        router.push({
          pathname: '/family/member/[id]',
          params: { id: item.id, familyId: activeFamily.id },
        })
      }
      left={(props) => (
        <List.Icon {...props} icon={item.memberType === 'child' ? 'baby-face' : 'account'} />
      )}
    />
  );

  return (
    <ScreenContainer noPadding>
      <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md }}>
        <View style={styles.header}>
          <Menu
            visible={switcherOpen}
            onDismiss={() => setSwitcherOpen(false)}
            anchor={
              <Button mode="text" onPress={() => setSwitcherOpen(true)} icon="chevron-down">
                {activeFamily.name}
              </Button>
            }
          >
            {families.map((family) => (
              <Menu.Item
                key={family.id}
                title={family.name}
                onPress={() => {
                  setActiveFamilyId(family.id);
                  setSwitcherOpen(false);
                }}
              />
            ))}
            <Divider />
            <Menu.Item
              title={t('family:createAnother')}
              onPress={() => {
                setSwitcherOpen(false);
                router.push('/family/create');
              }}
            />
          </Menu>
          {callerIsOwner ? <Chip compact>{t('family:role.owner')}</Chip> : null}
        </View>

        <SegmentedButtons
          value={view}
          onValueChange={(value) => setView(value as 'members' | 'tasks')}
          style={styles.viewToggle}
          buttons={[
            { value: 'members', label: t('family:tabs.members') },
            { value: 'tasks', label: t('family:tabs.tasks') },
          ]}
        />

        {view === 'members' ? (
          <>
            <View style={styles.actions}>
              {callerIsOwner ? (
                <Button
                  mode="contained-tonal"
                  onPress={() =>
                    router.push({
                      pathname: '/family/invite',
                      params: { familyId: activeFamily.id },
                    })
                  }
                  style={styles.actionButton}
                >
                  {t('family:inviteAction')}
                </Button>
              ) : null}
              <Button
                mode="contained-tonal"
                onPress={() =>
                  router.push({
                    pathname: '/family/add-child',
                    params: { familyId: activeFamily.id },
                  })
                }
                style={styles.actionButton}
              >
                {t('family:addChildAction')}
              </Button>
            </View>

            {callerIsOwner && invitations.length > 0 ? (
              <>
                <List.Subheader style={styles.subheader}>
                  {t('family:pendingInvitations')}
                </List.Subheader>
                {invitations.map((invitation) => (
                  <List.Item
                    key={invitation.id}
                    title={invitation.invitedEmail}
                    description={t('family:invite.status.pending')}
                  />
                ))}
                <Divider style={styles.divider} />
              </>
            ) : null}

            <List.Subheader style={styles.subheader}>{t('family:members')}</List.Subheader>
          </>
        ) : null}
      </View>

      {view === 'members' ? (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={renderMember}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.md }}
        />
      ) : (
        <FamilyTaskBoard familyId={activeFamily.id} members={members} />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  viewToggle: {
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  actionButton: {
    flex: 1,
  },
  subheader: {
    paddingHorizontal: 0,
  },
  divider: {
    marginVertical: 8,
  },
});
