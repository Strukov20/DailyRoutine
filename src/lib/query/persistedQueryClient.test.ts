import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Query } from '@tanstack/react-query';

import {
  buildPersistOptions,
  clearPersistedQueryCache,
  PERSISTED_QUERY_CACHE_BUSTER,
} from './persistedQueryClient';

// The real module transitively needs a native AsyncStorage module, which
// Jest has none of — the package's own officially-documented Jest mock
// (see docs/TEST_STRATEGY.md's "AsyncStorage is null" convention).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function fakeQuery(key: readonly unknown[]): Query {
  return { queryKey: key } as Query;
}

// A minimal but real DehydratedState, distinguished by queryHash so the
// isolation assertions below can actually tell "I got my own data back"
// apart from "I got the other profile's data back" — a fixture that
// type-checks but carries no distinguishing content (e.g. two identical
// empty states) would make these assertions pass even if isolation were
// silently broken.
function fakeClientState(marker: string) {
  return {
    queries: [{ queryHash: marker, queryKey: [marker], state: {} }],
    mutations: [],
  };
}

describe('buildPersistOptions', () => {
  it('builds a persister and options scoped to the given profile', () => {
    const options = buildPersistOptions('profile-1');
    expect(options.persister).toBeDefined();
    expect(options.buster).toBe(PERSISTED_QUERY_CACHE_BUSTER);
    expect(options.maxAge).toBeGreaterThan(0);
  });

  describe('shouldDehydrateQuery (the allowlist)', () => {
    const { shouldDehydrateQuery } = buildPersistOptions('profile-1').dehydrateOptions!;

    it.each([
      ['tasks', ['tasks', 'inbox', 'profile-1']],
      ['calendar', ['calendar', 'own-day', 'profile-1', '2026-01-01']],
      ['families', ['families']],
      ['conflicts', ['conflicts', 'family-1']],
      ['categories', ['categories']],
    ])('persists a %s query', (_label, key) => {
      expect(shouldDehydrateQuery!(fakeQuery(key))).toBe(true);
    });

    it.each([
      ['auth session state', ['auth-session']],
      ['an invitation preview', ['invitation-preview', 'token-abc']],
      ['a notification token query', ['notification-tokens']],
      ['a raw Realtime message shape', ['realtime-messages']],
      ['a notification outbox row', ['notifications-outbox']],
    ])('never persists %s (not on the allowlist)', (_label, key) => {
      expect(shouldDehydrateQuery!(fakeQuery(key))).toBe(false);
    });

    it('never persists a query with a non-string first key segment', () => {
      expect(shouldDehydrateQuery!(fakeQuery([{ nested: true }]))).toBe(false);
    });
  });

  it('uses a distinct storage key per profile (two different profiles never collide)', async () => {
    const optionsA = buildPersistOptions('profile-a');
    const optionsB = buildPersistOptions('profile-b');

    await optionsA.persister!.persistClient({
      timestamp: Date.now(),
      buster: PERSISTED_QUERY_CACHE_BUSTER,
      clientState: fakeClientState('from-a') as never,
    });
    await optionsB.persister!.persistClient({
      timestamp: Date.now(),
      buster: PERSISTED_QUERY_CACHE_BUSTER,
      clientState: fakeClientState('from-b') as never,
    });

    const restoredA = await optionsA.persister!.restoreClient();
    const restoredB = await optionsB.persister!.restoreClient();

    expect(restoredA?.clientState).toEqual(fakeClientState('from-a'));
    expect(restoredB?.clientState).toEqual(fakeClientState('from-b'));
  });
});

describe('clearPersistedQueryCache', () => {
  it("removes exactly that profile's storage entry, never a different profile's", async () => {
    const optionsA = buildPersistOptions('profile-a');
    const optionsB = buildPersistOptions('profile-b');
    await optionsA.persister!.persistClient({
      timestamp: Date.now(),
      buster: PERSISTED_QUERY_CACHE_BUSTER,
      clientState: fakeClientState('from-a') as never,
    });
    await optionsB.persister!.persistClient({
      timestamp: Date.now(),
      buster: PERSISTED_QUERY_CACHE_BUSTER,
      clientState: fakeClientState('from-b') as never,
    });

    await clearPersistedQueryCache('profile-a');

    expect(await optionsA.persister!.restoreClient()).toBeUndefined();
    expect((await optionsB.persister!.restoreClient())?.clientState).toEqual(fakeClientState('from-b'));
  });

  it('never throws even if the underlying storage call fails', async () => {
    const spy = jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(clearPersistedQueryCache('profile-a')).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
