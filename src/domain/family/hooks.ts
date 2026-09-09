import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  acceptFamilyInvitation,
  createChildProfile,
  createFamily,
  createFamilyInvitation,
  declineFamilyInvitation,
  deleteFamily,
  getInvitationPreview,
  leaveFamily,
  listFamilyInvitations,
  listFamilyMembers,
  listMyFamilies,
  removeFamilyMember,
  revokeFamilyInvitation,
  transferFamilyOwnership,
  updateChildProfile,
  type CreateChildProfileParams,
  type UpdateChildProfileParams,
} from '@/lib/family/familyService';
import { useUIStore } from '@/store/uiStore';

/**
 * TanStack Query hooks for families/members/invitations/children — the
 * only layer screens talk to for this feature (screens → hooks →
 * familyService → Supabase client, see docs/ARCHITECTURE.md). TanStack
 * Query is the source of truth for all of this server state; Zustand
 * (src/store/uiStore.ts) holds only the *selected* activeFamilyId, never
 * family data itself — see useActiveFamily() below, the one place that
 * reconciles the two.
 */

export const familyKeys = {
  myFamilies: ['families'] as const,
  members: (familyId: string) => ['families', familyId, 'members'] as const,
  invitations: (familyId: string) => ['families', familyId, 'invitations'] as const,
  invitationPreview: (token: string) => ['invitation-preview', token] as const,
};

export function useMyFamilies() {
  return useQuery({ queryKey: familyKeys.myFamilies, queryFn: listMyFamilies });
}

/**
 * Resolves which family the UI should currently show: the user's Zustand
 * preference if it still refers to a family they belong to, otherwise the
 * first family in the list (and persists that fallback back into the
 * store). Returns `activeFamily: null` while loading or if the user has no
 * family yet.
 */
export function useActiveFamily() {
  const familiesQuery = useMyFamilies();
  const activeFamilyId = useUIStore((state) => state.activeFamilyId);
  const setActiveFamilyId = useUIStore((state) => state.setActiveFamilyId);

  const families = familiesQuery.data ?? [];
  const resolvedId =
    activeFamilyId && families.some((family) => family.id === activeFamilyId)
      ? activeFamilyId
      : (families[0]?.id ?? null);

  useEffect(() => {
    if (familiesQuery.isSuccess && resolvedId !== activeFamilyId) {
      setActiveFamilyId(resolvedId);
    }
  }, [familiesQuery.isSuccess, resolvedId, activeFamilyId, setActiveFamilyId]);

  return {
    ...familiesQuery,
    families,
    activeFamily: families.find((family) => family.id === resolvedId) ?? null,
  };
}

export function useFamilyMembers(familyId: string | null) {
  return useQuery({
    queryKey: familyId ? familyKeys.members(familyId) : familyKeys.members('none'),
    queryFn: () => listFamilyMembers(familyId as string),
    enabled: familyId !== null,
  });
}

/** Owner-only per RLS — resolves to an empty list for a non-owner member. */
export function useFamilyInvitations(familyId: string | null) {
  return useQuery({
    queryKey: familyId ? familyKeys.invitations(familyId) : familyKeys.invitations('none'),
    queryFn: () => listFamilyInvitations(familyId as string),
    enabled: familyId !== null,
  });
}

export function useInvitationPreview(token: string | null) {
  return useQuery({
    queryKey: familyKeys.invitationPreview(token ?? 'none'),
    queryFn: () => getInvitationPreview(token as string),
    enabled: token !== null,
    retry: 0,
  });
}

export function useCreateFamily() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createFamily,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.myFamilies });
    },
  });
}

export function useCreateFamilyInvitation(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => createFamilyInvitation(familyId, email),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.invitations(familyId) });
    },
  });
}

export function useAcceptFamilyInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: acceptFamilyInvitation,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.myFamilies });
    },
  });
}

export function useDeclineFamilyInvitation() {
  return useMutation({ mutationFn: declineFamilyInvitation });
}

export function useRevokeFamilyInvitation(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeFamilyInvitation,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.invitations(familyId) });
    },
  });
}

export function useCreateChildProfile(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Omit<CreateChildProfileParams, 'familyId'>) =>
      createChildProfile({ ...params, familyId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.members(familyId) });
    },
  });
}

export function useUpdateChildProfile(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateChildProfileParams) => updateChildProfile(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.members(familyId) });
    },
  });
}

export function useRemoveFamilyMember(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeFamilyMember,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.members(familyId) });
    },
  });
}

/** Phase 10 — release-safety mutations. Realtime (family:<id> broadcast) also invalidates these same keys on every other connected device — see src/lib/realtime/invalidationMap.ts. */
export function useTransferFamilyOwnership(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (newOwnerMemberId: string) => transferFamilyOwnership(familyId, newOwnerMemberId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.members(familyId) });
      void queryClient.invalidateQueries({ queryKey: familyKeys.myFamilies });
    },
  });
}

/** Every member (including the caller) loses access to this family the instant this succeeds — see useActiveFamily()'s own fallback for what the UI shows next. */
export function useDeleteFamily() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteFamily,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.myFamilies });
    },
  });
}

/** Self-service — refused (22023 → 'invalid_or_expired') if the caller currently owns this family. */
export function useLeaveFamily() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: leaveFamily,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKeys.myFamilies });
    },
  });
}
