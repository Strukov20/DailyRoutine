import { createClient } from '@supabase/supabase-js';
import { onlineManager } from '@tanstack/react-query';

/**
 * Phase 9, Section 20 — the offline mutation queue's real local
 * integration suite: the *production* queue code (offlineQueueStore.ts,
 * offlineQueueReplay.ts) driven against a real local Supabase stack via
 * the app's own `supabase` client and `taskService.ts` — never a
 * test-only queue reimplementation, never a mocked RPC layer. Requires
 * `npm run supabase:start` first; run via `npm run e2e:offline`, not
 * `npm test` (see jest.e2e.config.js).
 *
 * Not exhaustive against the brief's full 13-point list — scoped to the
 * mechanisms that are genuinely only provable end-to-end (idempotent
 * replay against the *real* RPC, a stale-write conflict that never
 * overwrites the *real* row, and real cross-account queue isolation).
 * "Family mutations never queue offline" is verified instead by
 * construction/unit test (offlineQueueReplay.ts's switch has no
 * family/shared-task case, and no family mutation hook ever calls
 * enqueueOfflineOperation) — see src/lib/offline/offlineQueueReplay.test.ts.
 */

// Imported after jest.e2e.setup.ts has already injected real local
// credentials into process.env — these are the actual production
// modules, not mocks.
import { supabase } from '@/lib/supabase/client';
import { completePersonalTask, createPersonalTask, updatePersonalTask } from '@/lib/tasks/taskService';

import { runOfflineQueueReplay } from '../offlineQueueReplay';
import { useOfflineQueueStore } from '../offlineQueueStore';
import type { OfflineOperation } from '../types';

jest.setTimeout(30000);

const E2E_URL = process.env.E2E_SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY as string;
const adminClient = createClient(E2E_URL, SERVICE_ROLE_KEY);

const STAMP = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASSWORD = 'Str0ngPassw0rd!';
const createdUserIds: string[] = [];

async function createTestUser(label: string): Promise<{ id: string; email: string }> {
  const email = `e2e-offline-${label}-${STAMP}@example.com`;
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`failed to create test user ${label}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session || !data.user) throw error ?? new Error('sign-in failed');
  return data.user.id;
}

function fakeOp(overrides: Partial<OfflineOperation>): OfflineOperation {
  return {
    operationId: crypto.randomUUID(),
    profileId: '',
    operationType: 'create_personal_task',
    entityId: null,
    clientGeneratedId: null,
    payload: {},
    expectedUpdatedAt: null,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    status: 'pending',
    lastSafeErrorCode: null,
    ...overrides,
  };
}

async function resetQueueStore(): Promise<void> {
  await useOfflineQueueStore.getState().reset();
  useOfflineQueueStore.setState({ profileId: null, operations: [], isReplaying: false });
}

afterAll(async () => {
  await supabase.auth.signOut();
  // tasks.owner_profile_id_fkey does not cascade from auth.users (found by
  // this suite's own first run leaving 6 residual test users behind) — the
  // owned rows must go first, via the service-role client (bypasses RLS,
  // same as scripts/e2e-*.sh's own cleanup pattern), or every deleteUser
  // call below fails with a 23503 foreign-key violation and leaks the
  // account. Each deletion is independently caught so one failure never
  // aborts cleanup for the rest.
  for (const uid of createdUserIds) {
    const { error: tasksError } = await adminClient.from('tasks').delete().eq('owner_profile_id', uid);
    if (tasksError) console.warn(`cleanup: failed to delete tasks for ${uid}`, tasksError.message);
    const { error: userError } = await adminClient.auth.admin.deleteUser(uid);
    if (userError) console.warn(`cleanup: failed to delete user ${uid}`, userError.message);
  }
});

beforeEach(async () => {
  onlineManager.setOnline(true);
  await resetQueueStore();
});

describe('offline queue — real local Supabase integration', () => {
  it('a queued create replays exactly once against the real RPC, and a duplicate delivery never creates a second row', async () => {
    const owner = await createTestUser('idempotent');
    const profileId = await signIn(owner.email);

    const operationId = crypto.randomUUID();
    await useOfflineQueueStore.getState().hydrate(profileId);
    onlineManager.setOnline(false);
    const enqueueResult = await useOfflineQueueStore.getState().enqueue(
      fakeOp({
        operationId,
        profileId,
        clientGeneratedId: crypto.randomUUID(),
        payload: { title: 'E2E idempotent task' },
      }),
    );
    expect(enqueueResult).toEqual({ ok: true });

    onlineManager.setOnline(true);
    await runOfflineQueueReplay();

    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);

    const { data: rowsAfterFirstReplay } = await supabase
      .from('tasks')
      .select('id')
      .eq('owner_profile_id', profileId)
      .eq('title', 'E2E idempotent task');
    expect(rowsAfterFirstReplay).toHaveLength(1);

    // Simulate a duplicate delivery of the *same* offline operation (e.g. a
    // crash right after the first replay succeeded server-side but before
    // the client could remove it locally) by calling the real RPC again
    // with the identical client_operation_id — this is exactly what
    // replayOperation() does internally, exercised directly here against
    // the live database rather than through the queue's own bookkeeping,
    // which already discarded the op.
    const secondId = await createPersonalTask({
      title: 'E2E idempotent task',
      clientOperationId: operationId,
    });
    expect(secondId).toBe(rowsAfterFirstReplay![0]!.id);

    const { data: rowsAfterReplay } = await supabase
      .from('tasks')
      .select('id')
      .eq('owner_profile_id', profileId)
      .eq('title', 'E2E idempotent task');
    expect(rowsAfterReplay).toHaveLength(1);
  });

  it('a stale-write conflict is detected against the real row and never silently overwrites it', async () => {
    const owner = await createTestUser('staleversion');
    const profileId = await signIn(owner.email);

    const taskId = await createPersonalTask({ title: 'Original title' });
    const { data: original } = await supabase.from('tasks').select('updated_at').eq('id', taskId).single();
    const staleUpdatedAt = original!.updated_at;

    // A change made "on another device" — bumps updated_at server-side.
    await updatePersonalTask({ taskId, title: 'Changed elsewhere' });

    await useOfflineQueueStore.getState().hydrate(profileId);
    onlineManager.setOnline(false);
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({
        profileId,
        operationType: 'update_personal_task',
        entityId: taskId,
        expectedUpdatedAt: staleUpdatedAt,
        payload: { title: 'My offline edit' },
      }),
    );
    onlineManager.setOnline(true);
    await runOfflineQueueReplay();

    const ops = useOfflineQueueStore.getState().operations;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ status: 'failed', lastSafeErrorCode: 'conflict' });

    const { data: finalRow } = await supabase.from('tasks').select('title').eq('id', taskId).single();
    expect(finalRow!.title).toBe('Changed elsewhere');
  });

  it('a completed-while-offline task really is completed once replayed', async () => {
    const owner = await createTestUser('complete');
    const profileId = await signIn(owner.email);
    const taskId = await createPersonalTask({ title: 'Take vitamins' });

    await useOfflineQueueStore.getState().hydrate(profileId);
    onlineManager.setOnline(false);
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({ profileId, operationType: 'complete_personal_task', entityId: taskId }),
    );
    onlineManager.setOnline(true);
    await runOfflineQueueReplay();

    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
    const { data: row } = await supabase.from('tasks').select('completed_at').eq('id', taskId).single();
    expect(row!.completed_at).not.toBeNull();
    // Idempotent replay: completing an already-completed task again must
    // never error and must never un-complete it.
    await expect(completePersonalTask(taskId)).resolves.toBeUndefined();
    const { data: rowAfterReplay } = await supabase.from('tasks').select('completed_at').eq('id', taskId).single();
    expect(rowAfterReplay!.completed_at).not.toBeNull();
  });

  it("two real accounts' offline queues never mix — hydrating profile B never sees profile A's queued operation", async () => {
    const ownerA = await createTestUser('isoA');
    const ownerB = await createTestUser('isoB');

    const profileIdA = await signIn(ownerA.email);
    await useOfflineQueueStore.getState().hydrate(profileIdA);
    onlineManager.setOnline(false);
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({ profileId: profileIdA, payload: { title: "A's offline task" } }),
    );
    expect(useOfflineQueueStore.getState().operations).toHaveLength(1);

    // A fresh app session for profile B (a real account switch): reset the
    // in-memory store, sign in as B, hydrate B's own persisted queue.
    await resetQueueStore();
    const profileIdB = await signIn(ownerB.email);
    await useOfflineQueueStore.getState().hydrate(profileIdB);

    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
    expect(useOfflineQueueStore.getState().profileId).toBe(profileIdB);

    // B never sees A's queued task once replayed under B's own session.
    onlineManager.setOnline(true);
    await runOfflineQueueReplay();
    const { data: bRows } = await supabase
      .from('tasks')
      .select('id')
      .eq('owner_profile_id', profileIdB)
      .eq('title', "A's offline task");
    expect(bRows).toHaveLength(0);
  });
});
