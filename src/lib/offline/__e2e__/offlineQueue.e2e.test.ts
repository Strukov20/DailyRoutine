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
import { selectOperationById, useOfflineQueueStore } from '../offlineQueueStore';
import { applyMyChange, discardSyncIssue, getConflictComparison } from '../syncIssueResolution';
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
    reviewedVersion: null,
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
        reviewedVersion: null,
        payload: { title: 'My offline edit' },
      }),
    );
    onlineManager.setOnline(true);
    await runOfflineQueueReplay();

    const ops = useOfflineQueueStore.getState().operations;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ status: 'conflict', lastSafeErrorCode: 'conflict' });

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

  /**
   * Sync Issues completion pass, Section 12's own 14-step scenario, final
   * security/concurrency pass — the production resolution flows
   * (syncIssueResolution.ts) driven end-to-end against the real local
   * stack: a stale-write conflict reviewed via a real server fetch,
   * resolved once by "Keep server version" (never replays again) and once
   * by "Apply my change" (only the original patch's own fields change
   * server-side). Round 3 proves the "stale review" concurrency window
   * specifically: a real concurrent write landing *after* the user's
   * review but *before* they press Apply is refused (never silently
   * merged into), the comparison is refreshed in place, and only an
   * explicit second Apply — after that refresh — actually mutates the row.
   */
  it('the full stale-write review/resolve cycle: keep-server-version, then apply-my-change, then a write after review requires an explicit re-review before Apply', async () => {
    const owner = await createTestUser('reviewcycle');
    const profileId = await signIn(owner.email);

    // --- Round 1: "Keep server version" -------------------------------
    // 1. Queue an offline update.
    const taskId = await createPersonalTask({ title: 'Original title', description: 'Original description' });
    const { data: original } = await supabase.from('tasks').select('updated_at').eq('id', taskId).single();
    const staleUpdatedAt = original!.updated_at as string;

    await useOfflineQueueStore.getState().hydrate(profileId);
    const operationId = crypto.randomUUID();
    onlineManager.setOnline(false);
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({
        operationId,
        profileId,
        operationType: 'update_personal_task',
        entityId: taskId,
        expectedUpdatedAt: staleUpdatedAt,
        reviewedVersion: null,
        payload: { title: 'My offline title' },
      }),
    );

    // 2. Modify the same task from "another device" (same account, a real
    // online RPC call — the established convention this file already uses
    // for simulating a concurrent write from elsewhere).
    onlineManager.setOnline(true);
    await updatePersonalTask({ taskId, title: 'Changed on another device' });

    // 3. Replay and receive a stale conflict.
    await runOfflineQueueReplay();
    let op = selectOperationById(useOfflineQueueStore.getState(), operationId);
    expect(op).toMatchObject({ status: 'conflict', lastSafeErrorCode: 'conflict' });

    // 4/5. Fetch the latest server version and verify both comparison values.
    const comparison = await getConflictComparison(operationId);
    expect(comparison?.serverTask?.title).toBe('Changed on another device');
    expect(comparison?.fields).toEqual([
      { field: 'title', local: 'My offline title', server: 'Changed on another device' },
    ]);

    // 6. Choose Keep server version.
    await discardSyncIssue(operationId);

    // 7. Confirm the local operation never replays.
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
    await runOfflineQueueReplay(); // a no-op FIFO pass — nothing left to replay
    const { data: afterKeep } = await supabase.from('tasks').select('title').eq('id', taskId).single();
    expect(afterKeep!.title).toBe('Changed on another device');

    // --- Round 2: "Apply my change" ------------------------------------
    // 8. Repeat with another conflict, on a fresh task.
    const taskId2 = await createPersonalTask({ title: 'Second original', description: 'Second description' });
    const { data: original2 } = await supabase.from('tasks').select('updated_at').eq('id', taskId2).single();
    const staleUpdatedAt2 = original2!.updated_at as string;

    await useOfflineQueueStore.getState().hydrate(profileId);
    const operationId2 = crypto.randomUUID();
    onlineManager.setOnline(false);
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({
        operationId: operationId2,
        profileId,
        operationType: 'update_personal_task',
        entityId: taskId2,
        expectedUpdatedAt: staleUpdatedAt2,
        reviewedVersion: null,
        payload: { title: 'My second offline title' },
      }),
    );
    onlineManager.setOnline(true);
    await updatePersonalTask({ taskId: taskId2, title: 'Second: changed elsewhere' });
    await runOfflineQueueReplay();
    op = selectOperationById(useOfflineQueueStore.getState(), operationId2);
    expect(op?.status).toBe('conflict');

    // Apply is only ever valid after an explicit review — final security/
    // concurrency pass. Review first (records reviewedVersion), then apply
    // with nothing else having changed in between.
    await getConflictComparison(operationId2);

    // 9. Choose Apply my change.
    const applyOutcome = await applyMyChange(operationId2);
    expect(applyOutcome).toEqual({ result: 'succeeded' });

    // 10. Confirm only the original patch's own field (title) changed —
    // description, set by neither side's patch, keeps whatever the
    // "other device" last wrote it as (the row's real current value at
    // apply time), never silently reset to the offline snapshot's own
    // stale value.
    const { data: afterApply } = await supabase.from('tasks').select('title, description').eq('id', taskId2).single();
    expect(afterApply!.title).toBe('My second offline title');
    expect(afterApply!.description).toBe('Second description');
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);

    // --- Round 3: a second concurrent write lands after review, before Apply ---
    // Final security/concurrency pass — the "stale review" window
    // (Section 5: "if currentVersion != reviewedVersion, do not mutate;
    // refresh the comparison; remain in Needs review; require another
    // explicit Apply after review"). Set up a third conflict, review it
    // once, then let *another* concurrent write land before Apply is
    // pressed.
    const taskId3 = await createPersonalTask({ title: 'Third original', description: 'Third description' });
    const { data: original3 } = await supabase.from('tasks').select('updated_at').eq('id', taskId3).single();
    const staleUpdatedAt3 = original3!.updated_at as string;

    await useOfflineQueueStore.getState().hydrate(profileId);
    const operationId3 = crypto.randomUUID();
    onlineManager.setOnline(false);
    await useOfflineQueueStore.getState().enqueue(
      fakeOp({
        operationId: operationId3,
        profileId,
        operationType: 'update_personal_task',
        entityId: taskId3,
        expectedUpdatedAt: staleUpdatedAt3,
        reviewedVersion: null,
        payload: { title: 'My third offline title' },
      }),
    );
    onlineManager.setOnline(true);
    await updatePersonalTask({ taskId: taskId3, title: 'Third: first concurrent change' });
    await runOfflineQueueReplay();
    op = selectOperationById(useOfflineQueueStore.getState(), operationId3);
    expect(op?.status).toBe('conflict');

    // Reviewed once (comparison fetched, reviewedVersion recorded)...
    await getConflictComparison(operationId3);
    // ...then a *second* concurrent write lands before Apply is pressed —
    // the exact scenario the reviewed version must protect against.
    await updatePersonalTask({ taskId: taskId3, title: 'Third: second concurrent change' });

    // 11/12. Apply refuses to mutate against a version the user never
    // actually reviewed — the server row is untouched, the operation
    // stays 'conflict', and the safe "changed again" outcome is returned
    // rather than a silent last-write-wins merge.
    const staleOutcome = await applyMyChange(operationId3);
    expect(staleOutcome).toEqual({ result: 'stale_review' });
    op = selectOperationById(useOfflineQueueStore.getState(), operationId3);
    expect(op?.status).toBe('conflict');
    const { data: afterStaleAttempt } = await supabase.from('tasks').select('title').eq('id', taskId3).single();
    expect(afterStaleAttempt!.title).toBe('Third: second concurrent change');

    // The stale check itself refreshed reviewedVersion to what it just
    // fetched — the user must explicitly review the (now-current) result
    // and press Apply again; with nothing else having changed since, this
    // second explicit Apply succeeds and merges only the original patch's
    // own field (title) into the row's real, live state — never touching
    // description, which neither side's patch named.
    const secondApplyOutcome = await applyMyChange(operationId3);
    expect(secondApplyOutcome).toEqual({ result: 'succeeded' });
    op = selectOperationById(useOfflineQueueStore.getState(), operationId3);
    expect(op).toBeUndefined();
    const { data: afterSecondApply } = await supabase
      .from('tasks')
      .select('title, description')
      .eq('id', taskId3)
      .single();
    expect(afterSecondApply!.title).toBe('My third offline title');
    expect(afterSecondApply!.description).toBe('Third description');

    // A repeat Apply on the now-resolved (no longer queued) operation is a
    // safe, idempotent no-op — a double-tap never re-applies or errors.
    const repeatApplyOutcome = await applyMyChange(operationId3);
    expect(repeatApplyOutcome).toEqual({ result: 'not_applicable' });

    // "Resolve" is already terminal from the successful Apply above —
    // discarding an already-resolved operation is a safe, idempotent no-op.
    await discardSyncIssue(operationId3);

    // Verify zero residue across the whole scenario — nothing left queued
    // for this profile at all.
    expect(useOfflineQueueStore.getState().operations).toHaveLength(0);
  });
});
