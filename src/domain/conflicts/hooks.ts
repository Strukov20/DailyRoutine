import { useQuery } from '@tanstack/react-query';

import { listFamilyConflicts } from '@/lib/conflicts/conflictService';

export const conflictKeys = {
  forFamily: (familyId: string, fromUtc: string, toUtc: string) =>
    ['conflicts', 'family', familyId, fromUtc, toUtc] as const,
};

/**
 * The Conflict Center's own read (Section 15) — also what a Calendar/
 * Family Today badge (Section 15) sources its count from. Query key starts
 * with the literal `'conflicts'` prefix the Realtime invalidation map
 * (src/lib/realtime/invalidationMap.ts) already targets for every
 * tasks/events/responsibilities/members broadcast, so this refetches
 * automatically on a relevant cross-device change — no separate wiring
 * needed here.
 */
export function useFamilyConflicts(familyId: string | null, fromUtc: string, toUtc: string) {
  return useQuery({
    queryKey: conflictKeys.forFamily(familyId ?? 'none', fromUtc, toUtc),
    queryFn: () => listFamilyConflicts(familyId as string, fromUtc, toUtc),
    enabled: familyId !== null,
  });
}
