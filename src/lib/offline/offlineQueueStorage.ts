import AsyncStorage from '@react-native-async-storage/async-storage';

import { createLogger } from '@/lib/logger/logger';

import type { OfflineOperation } from './types';

const logger = createLogger('offline-queue-storage');

// Bumping this invalidates every persisted queue on next launch (Section 10
// treats a schema-incompatible queue the same way the read cache treats a
// schema-incompatible cache — dropped, never blindly replayed against a
// newer RPC shape). Same convention as persistedQueryClient's own buster.
const SCHEMA_VERSION = 'phase9-v1';

function storageKey(profileId: string): string {
  return `familyflow-offline-queue-${SCHEMA_VERSION}-${profileId}`;
}

/** Never throws — a corrupted or missing entry reads back as an empty queue. */
export async function loadQueue(profileId: string): Promise<OfflineOperation[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(profileId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineOperation[]) : [];
  } catch (error) {
    logger.warn('failed to load the persisted offline queue; starting empty', {
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Never throws — a failed write is logged and otherwise silently absorbed, matching clearPersistedQueryCache's convention. */
export async function saveQueue(profileId: string, queue: OfflineOperation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(profileId), JSON.stringify(queue));
  } catch (error) {
    logger.warn('failed to persist the offline queue', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Section 12 — cleared before logout/account switch, same as the persisted read cache. */
export async function clearQueue(profileId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(profileId));
  } catch (error) {
    logger.warn('failed to clear the persisted offline queue', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
