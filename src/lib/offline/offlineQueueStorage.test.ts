import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearQueue, loadQueue, saveQueue } from './offlineQueueStorage';
import type { OfflineOperation } from './types';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function fakeOp(operationId: string, profileId: string): OfflineOperation {
  return {
    operationId,
    profileId,
    operationType: 'create_personal_task',
    entityId: null,
    clientGeneratedId: 'client-1',
    payload: { title: 'Buy milk' },
    expectedUpdatedAt: null,
    reviewedVersion: null,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: 'pending',
    lastSafeErrorCode: null,
  };
}

describe('offlineQueueStorage', () => {
  it('round-trips a queue for a profile', async () => {
    const queue = [fakeOp('op-1', 'profile-a')];
    await saveQueue('profile-a', queue);
    expect(await loadQueue('profile-a')).toEqual(queue);
  });

  it('reads back an empty array for a profile with nothing persisted', async () => {
    expect(await loadQueue('profile-never-used')).toEqual([]);
  });

  it("never mixes one profile's persisted queue into another's read", async () => {
    await saveQueue('profile-a', [fakeOp('op-a', 'profile-a')]);
    await saveQueue('profile-b', [fakeOp('op-b', 'profile-b')]);

    expect((await loadQueue('profile-a'))[0]?.operationId).toBe('op-a');
    expect((await loadQueue('profile-b'))[0]?.operationId).toBe('op-b');
  });

  it("clearQueue removes exactly that profile's entry, never a different profile's", async () => {
    await saveQueue('profile-a', [fakeOp('op-a', 'profile-a')]);
    await saveQueue('profile-b', [fakeOp('op-b', 'profile-b')]);

    await clearQueue('profile-a');

    expect(await loadQueue('profile-a')).toEqual([]);
    expect((await loadQueue('profile-b')).length).toBe(1);
  });

  it('never throws even when the underlying storage is corrupted', async () => {
    await AsyncStorage.setItem('familyflow-offline-queue-phase9-v1-profile-c', 'not json{{{');
    await expect(loadQueue('profile-c')).resolves.toEqual([]);
  });

  it('never throws even if the underlying storage call fails', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(saveQueue('profile-a', [])).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
