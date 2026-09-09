import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

import { createLogger } from '@/lib/logger/logger';

const logger = createLogger('persisted-query-client');

/**
 * Phase 9 offline read cache (Section 8) — the officially supported
 * TanStack Query provider/persister pattern (`@tanstack/query-async-storage-persister`
 * + `PersistQueryClientProvider`, see PersistedQueryProvider.tsx), not a
 * hand-rolled AsyncStorage read/write cycle.
 *
 * Explicit allowlist, not a denylist: a query is persisted only if its key
 * starts with one of these prefixes. Everything else — auth/session state
 * (owned by Supabase's own AsyncStorage-backed storage, never TanStack
 * Query), invitation/notification tokens, mutation results, raw Realtime
 * messages, notification-outbox/delivery rows (none of which are ever
 * TanStack queries to begin with) — is excluded by construction, not by
 * remembering to exclude it.
 */
const PERSISTED_QUERY_KEY_PREFIXES: readonly string[] = [
  'tasks', // Today/Tomorrow/Inbox (taskKeys.inbox/forDate/overdue)
  'calendar', // Day Calendar (calendarKeys.ownDay/familySchedule/familyResponsibilities)
  'families', // family members / my-families (familyKeys.myFamilies/members)
  'conflicts', // Conflict Center summary (conflictKeys.*)
  'categories', // needed to render task/event category chips offline
];

function isAllowlistedQueryKey(query: Query): boolean {
  const [first] = query.queryKey;
  return typeof first === 'string' && PERSISTED_QUERY_KEY_PREFIXES.includes(first);
}

/**
 * Bumped whenever a persisted query's *shape* changes incompatibly (a
 * mapper adds a required field an old cached row wouldn't have, a query
 * key's parameter order changes, etc.) — every previously-persisted cache
 * for every account is discarded on mismatch, never partially replayed
 * against code that no longer expects that shape. Independent of the app
 * version — bump this, not package.json, when this specific
 * compatibility class changes.
 */
export const PERSISTED_QUERY_CACHE_BUSTER = 'phase9-v1';

/** 24h — cached data older than this is never rehydrated at all, only ever a same-day view of "last known state," never stale enough to look current. */
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

function storageKeyForProfile(profileId: string): string {
  return `familyflow-query-cache-${profileId}`;
}

/**
 * One persister per signed-in profile, keyed by profile id — this is what
 * makes the cache account-partitioned (Section 8: "cache partitioned by
 * authenticated profile," "no data from the previous account flashes
 * after account switch"). PersistedQueryProvider.tsx remounts the whole
 * `PersistQueryClientProvider` subtree with `key={profileId}` on account
 * change, so a different profile never even briefly shares this instance
 * — see that file for why a fresh persister object, not just a fresh
 * storage key string, is required for TanStack's own internal restore
 * bookkeeping to behave correctly across the swap.
 */
export function createPersisterForProfile(profileId: string) {
  return createAsyncStoragePersister({
    storage: AsyncStorage,
    key: storageKeyForProfile(profileId),
    throttleTime: 1000,
  });
}

export function buildPersistOptions(
  profileId: string,
): Omit<PersistQueryClientOptions, 'queryClient'> {
  return {
    persister: createPersisterForProfile(profileId),
    maxAge: MAX_CACHE_AGE_MS,
    buster: PERSISTED_QUERY_CACHE_BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: isAllowlistedQueryKey,
    },
  };
}

/**
 * Called on real sign-out (never on a mere account *switch* between two
 * families under the same profile, which is a different concept — see
 * docs/DECISIONS.md, "Phase 9") — removes that profile's persisted cache
 * from AsyncStorage entirely, so nothing survives to be found by another
 * session on the same device. Never throws: a storage failure here must
 * not block sign-out from completing.
 */
export async function clearPersistedQueryCache(profileId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKeyForProfile(profileId));
  } catch (error) {
    logger.warn('failed to clear persisted query cache on sign-out', {
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
