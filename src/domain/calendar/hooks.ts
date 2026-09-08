import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth/AuthProvider';
import {
  acceptEventResponsibility,
  assignEventResponsibility,
  cancelEvent,
  createChildEvent,
  createFamilyEvent,
  createPersonalEvent,
  declineEventResponsibility,
  getEvent,
  hasMemberScheduleConflict,
  listFamilyResponsibilitiesForRange,
  listFamilyScheduleForRange,
  listOwnEventsForRange,
  listResponsibilitiesForEvent,
  reassignEventResponsibility,
  removeEventResponsibility,
  takeEventResponsibility,
  updateEvent,
  type CreateFamilyEventParams,
  type CreatePersonalEventParams,
  type UpdateEventParams,
} from '@/lib/calendar/calendarService';
import type { CreateChildEventParams } from './types';

/**
 * TanStack Query hooks for the family calendar (Phase 7) — the only layer
 * screens talk to for this feature (screens → hooks → calendarService →
 * Supabase client, see docs/ARCHITECTURE.md, "Layering"). Mirrors
 * src/domain/tasks/hooks.ts.
 */

export const calendarKeys = {
  ownDay: (profileId: string, startUtc: string) => ['calendar', 'own-day', profileId, startUtc] as const,
  familySchedule: (familyId: string, startUtc: string) =>
    ['calendar', 'family-schedule', familyId, startUtc] as const,
  familyResponsibilities: (familyId: string, startUtc: string) =>
    ['calendar', 'family-responsibilities', familyId, startUtc] as const,
  event: (eventId: string) => ['calendar', 'event', eventId] as const,
  responsibilities: (eventId: string) => ['calendar', 'responsibilities', eventId] as const,
};

function invalidateCalendarQueries(queryClient: QueryClient, familyId?: string): void {
  void queryClient.invalidateQueries({ queryKey: ['calendar', 'own-day'] });
  if (familyId) {
    void queryClient.invalidateQueries({ queryKey: ['calendar', 'family-schedule'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar', 'family-responsibilities'] });
  }
}

/** The caller's own events (personal or family-linked) for the local day [startUtc, endUtc). */
export function useOwnDayEvents(startUtc: string, endUtc: string) {
  const { profile } = useAuth();
  const profileId = profile?.id ?? null;
  return useQuery({
    queryKey: calendarKeys.ownDay(profileId ?? 'none', startUtc),
    queryFn: () => listOwnEventsForRange(profileId as string, startUtc, endUtc),
    enabled: profileId !== null,
  });
}

/** The sanitized family day agenda — events (Busy blocks included). */
export function useFamilyDaySchedule(familyId: string | null, startUtc: string, endUtc: string) {
  return useQuery({
    queryKey: calendarKeys.familySchedule(familyId ?? 'none', startUtc),
    queryFn: () => listFamilyScheduleForRange(familyId as string, startUtc, endUtc),
    enabled: familyId !== null,
  });
}

/** The sanitized family day agenda — drop-off/pick-up/etc. responsibilities. */
export function useFamilyDayResponsibilities(familyId: string | null, startUtc: string, endUtc: string) {
  return useQuery({
    queryKey: calendarKeys.familyResponsibilities(familyId ?? 'none', startUtc),
    queryFn: () => listFamilyResponsibilitiesForRange(familyId as string, startUtc, endUtc),
    enabled: familyId !== null,
  });
}

export function useEvent(eventId: string | null) {
  return useQuery({
    queryKey: calendarKeys.event(eventId ?? 'none'),
    queryFn: () => getEvent(eventId as string),
    enabled: eventId !== null,
  });
}

export function useEventResponsibilities(eventId: string | null) {
  return useQuery({
    queryKey: calendarKeys.responsibilities(eventId ?? 'none'),
    queryFn: () => listResponsibilitiesForEvent(eventId as string),
    enabled: eventId !== null,
  });
}

/**
 * Read-only, advisory — never blocks a save (see docs/DECISIONS.md, "Phase
 * 7"). `enabled` requires both a member and a fully-formed range, so a
 * half-filled editor never fires a request.
 */
export function useScheduleConflict(
  memberId: string | null,
  startUtc: string | null,
  endUtc: string | null,
  excludeResponsibilityId?: string,
) {
  return useQuery({
    queryKey: ['calendar', 'conflict', memberId, startUtc, endUtc, excludeResponsibilityId ?? null] as const,
    queryFn: () => hasMemberScheduleConflict(memberId as string, startUtc as string, endUtc as string, excludeResponsibilityId),
    enabled: memberId !== null && startUtc !== null && endUtc !== null,
  });
}

export function useCreatePersonalEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreatePersonalEventParams) => createPersonalEvent(params),
    onSuccess: (_data, params) => invalidateCalendarQueries(queryClient, params.familyId),
  });
}

export function useCreateFamilyEvent(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Omit<CreateFamilyEventParams, 'familyId'>) => createFamilyEvent({ ...params, familyId }),
    onSuccess: () => invalidateCalendarQueries(queryClient, familyId),
  });
}

export function useCreateChildEvent(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: Omit<CreateChildEventParams, 'familyId'>) => createChildEvent({ ...params, familyId }),
    onSuccess: () => invalidateCalendarQueries(queryClient, familyId),
  });
}

export function useUpdateEvent(familyId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateEventParams) => updateEvent(params),
    onSuccess: (_data, params) => {
      invalidateCalendarQueries(queryClient, familyId);
      void queryClient.invalidateQueries({ queryKey: calendarKeys.event(params.eventId) });
    },
  });
}

export function useCancelEvent(familyId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => cancelEvent(eventId),
    onSuccess: () => invalidateCalendarQueries(queryClient, familyId),
  });
}

/**
 * Responsibility-state mutations are deliberately *not* optimistic — same
 * rationale as the shared-task assignment mutations
 * (src/domain/tasks/hooks.ts): server-side validation (membership, current
 * status, row locking) has no trivially-safe client guess, and the absence
 * of an optimistic path doubles as the offline guard (Section 12) — a
 * mutation attempted offline simply fails via TanStack Query's network-aware
 * defaults instead of appearing to succeed.
 */
function useResponsibilityMutation<TVariables>(
  familyId: string,
  mutationFn: (variables: TVariables) => Promise<void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateCalendarQueries(queryClient, familyId),
  });
}

export function useAssignEventResponsibility(familyId: string) {
  return useResponsibilityMutation(
    familyId,
    ({ responsibilityId, assigneeMemberId }: { responsibilityId: string; assigneeMemberId: string }) =>
      assignEventResponsibility(responsibilityId, assigneeMemberId),
  );
}

export function useReassignEventResponsibility(familyId: string) {
  return useResponsibilityMutation(
    familyId,
    ({ responsibilityId, assigneeMemberId }: { responsibilityId: string; assigneeMemberId: string }) =>
      reassignEventResponsibility(responsibilityId, assigneeMemberId),
  );
}

export function useTakeEventResponsibility(familyId: string) {
  return useResponsibilityMutation(familyId, (responsibilityId: string) =>
    takeEventResponsibility(responsibilityId),
  );
}

export function useAcceptEventResponsibility(familyId: string) {
  return useResponsibilityMutation(familyId, (responsibilityId: string) =>
    acceptEventResponsibility(responsibilityId),
  );
}

export function useDeclineEventResponsibility(familyId: string) {
  return useResponsibilityMutation(familyId, (responsibilityId: string) =>
    declineEventResponsibility(responsibilityId),
  );
}

export function useRemoveEventResponsibility(familyId: string) {
  return useResponsibilityMutation(familyId, (responsibilityId: string) =>
    removeEventResponsibility(responsibilityId),
  );
}
