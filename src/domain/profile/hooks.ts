import { useMutation } from '@tanstack/react-query';

import { requestAccountDeletion } from '@/lib/profile/profileService';

/**
 * Phase 10 — self-service account deletion. No cache invalidation here on
 * success: the screen signs the user out right after (see
 * app/(app)/profile.tsx), and AuthProvider's own SIGNED_OUT handler
 * already clears every cache/store this account's data could live in.
 */
export function useRequestAccountDeletion() {
  return useMutation({ mutationFn: requestAccountDeletion });
}
