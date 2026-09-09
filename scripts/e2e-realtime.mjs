#!/usr/bin/env node
// Phase 9, Section 19 — a real local Realtime WebSocket integration test.
// Five real personas (owner client A, a second connection as the same
// owner — "client B", an adult family member, an outsider, and a member
// later removed from the family), each holding a real WebSocket
// subscription (supabase-js `.channel(topic, {config:{private:true}})`)
// against the real local Realtime server — never a simulated GUC (that's
// what supabase/tests/150_realtime_offline_conflicts_test.sql's pgTAP
// suite already covers) and never a mocked client.
//
// LOCAL SUPABASE ONLY — same safety check as every scripts/e2e-*.sh
// script: refuses to run against anything but 127.0.0.1/localhost.
//
// Usage: npm run e2e:realtime
// Prerequisite: the local Supabase stack running (npm run supabase:start).
// Every identity/row this script creates is unique per run and cleaned up
// on exit, so a repeat run without a DB reset in between is safe.
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const BOUNDED_WAIT_MS = 8000;
const SUBSCRIBE_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 150;

function readLocalSupabaseStatus() {
  const raw = execSync('npx supabase status -o json', { encoding: 'utf-8' });
  const status = JSON.parse(raw);
  if (!status.API_URL || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
    throw new Error("Could not read API_URL/ANON_KEY/SERVICE_ROLE_KEY from 'supabase status'.");
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:[0-9]+)?(\/.*)?$/.test(status.API_URL)) {
    throw new Error(`Refusing to run: API_URL '${status.API_URL}' is not localhost/127.0.0.1.`);
  }
  return status;
}

const status = readLocalSupabaseStatus();
const adminClient = createClient(status.API_URL, status.SERVICE_ROLE_KEY);

let passed = 0;
let failed = 0;
const failures = [];
function check(label, ok) {
  if (ok) {
    passed += 1;
    console.log(`  ok   - ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL - ${label}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = BOUNDED_WAIT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = predicate();
    if (result) return result;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

const STAMP = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PASSWORD = 'Str0ngPassw0rd!';
const createdUserIds = [];

async function createTestUser(label) {
  const email = `e2e-realtime-${label}-${STAMP}@example.com`;
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`failed to create test user ${label}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

function newClient() {
  return createClient(status.API_URL, status.ANON_KEY);
}

async function signIn(client, email) {
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) throw error ?? new Error('sign-in failed');
  return data.user.id;
}

/** Subscribes to a private topic, collecting every broadcast into `.messages` and resolving with the first subscribe status observed. Bounded — never hangs indefinitely on a topic that's silently refused. */
function subscribeTopic(client, topic) {
  const messages = [];
  let resolveStatus;
  const statusPromise = new Promise((resolve) => {
    resolveStatus = resolve;
  });
  let settled = false;
  // A plain mutable holder (not frozen at the first status callback) — the
  // burst/reconnect scenarios below check `.status` *after* further
  // activity, and a channel error arriving after the initial SUBSCRIBED
  // must actually be observable, not just the first-ever status.
  const result = { channel: null, messages, status: null };
  const channel = client.channel(topic, { config: { private: true } });
  result.channel = channel;
  channel
    .on('broadcast', { event: 'invalidate' }, ({ payload }) => messages.push(payload))
    .subscribe((subscribeStatus) => {
      result.status = subscribeStatus;
      if (!settled) {
        settled = true;
        resolveStatus();
      }
    });
  const timeout = sleep(SUBSCRIBE_TIMEOUT_MS).then(() => {
    if (!settled) {
      settled = true;
      result.status = result.status ?? 'CLIENT_TIMEOUT';
      resolveStatus();
    }
  });
  return Promise.race([statusPromise, timeout]).then(() => result);
}

function payloadHasEntity(messages, entity) {
  return messages.some((message) => message?.entity === entity);
}

function rawContains(messages, marker) {
  return messages.some((message) => JSON.stringify(message).includes(marker));
}

async function main() {
  console.log(`== Creating real auth.users accounts (STAMP ${STAMP}) ==`);
  const owner = await createTestUser('owner');
  const adult = await createTestUser('adult');
  const outsider = await createTestUser('outsider');
  const removed = await createTestUser('removed');

  const ownerA = newClient();
  const ownerB = newClient(); // a second real connection, same account — "another device"
  const adultClient = newClient();
  const outsiderClient = newClient();
  const removedClient = newClient();

  const ownerId = await signIn(ownerA, owner.email);
  await signIn(ownerB, owner.email);
  const adultId = await signIn(adultClient, adult.email);
  const outsiderId = await signIn(outsiderClient, outsider.email);
  const removedId = await signIn(removedClient, removed.email);
  check('all five real accounts signed in with a real session', Boolean(ownerId && adultId && outsiderId && removedId));

  console.log('== Family setup ==');
  const { data: familyRow, error: familyError } = await ownerA.rpc('create_family_with_owner', {
    p_name: 'E2E Realtime Family',
  });
  const familyId = familyRow?.[0]?.family_id;
  check('owner created a family', Boolean(familyId) && !familyError);

  const { data: adultInvite } = await ownerA.rpc('create_family_invitation', {
    p_family_id: familyId,
    p_invited_email: adult.email,
  });
  await adultClient.rpc('accept_family_invitation', { p_token: adultInvite?.[0]?.token });

  const { data: removedInvite } = await ownerA.rpc('create_family_invitation', {
    p_family_id: familyId,
    p_invited_email: removed.email,
  });
  const { data: removedAccept } = await removedClient.rpc('accept_family_invitation', {
    p_token: removedInvite?.[0]?.token,
  });
  const removedMemberId = removedAccept?.[0]?.family_member_id;
  check('adult and removed-member both accepted real invitations', Boolean(removedMemberId));

  console.log('== Subscribing every persona to its real private channel(s) ==');
  const ownerATasks = await subscribeTopic(ownerA, `profile:${ownerId}`);
  const ownerAFamily = await subscribeTopic(ownerA, `family:${familyId}`);
  const ownerBTasks = await subscribeTopic(ownerB, `profile:${ownerId}`);
  const adultProfile = await subscribeTopic(adultClient, `profile:${adultId}`);
  const adultFamily = await subscribeTopic(adultClient, `family:${familyId}`);
  const outsiderProfile = await subscribeTopic(outsiderClient, `profile:${outsiderId}`);
  const outsiderFamilyAttempt = await subscribeTopic(outsiderClient, `family:${familyId}`);
  const removedFamily = await subscribeTopic(removedClient, `family:${familyId}`);

  check("owner's own profile channel subscribes (client A)", ownerATasks.status === 'SUBSCRIBED');
  check("owner's own family channel subscribes (client A)", ownerAFamily.status === 'SUBSCRIBED');
  check("the same owner's second connection (client B) also subscribes to their own profile channel", ownerBTasks.status === 'SUBSCRIBED');
  check("an active family member's own profile channel subscribes", adultProfile.status === 'SUBSCRIBED');
  check("an active family member's family channel subscribes", adultFamily.status === 'SUBSCRIBED');
  check("an outsider's own profile channel subscribes (their own topic is always theirs)", outsiderProfile.status === 'SUBSCRIBED');
  check("an outsider is refused a family channel they don't belong to", outsiderFamilyAttempt.status !== 'SUBSCRIBED');
  check('a currently-active family member (about to be removed) subscribes to the family channel', removedFamily.status === 'SUBSCRIBED');

  console.log('== A personal task change broadcasts to every real device on the same account, and nowhere else ==');
  const taskMarker = `SECRET-MARKER-e2e-realtime-task-${STAMP}`;
  await ownerA.rpc('create_personal_task', { p_title: taskMarker });

  const ownerASawTask = await waitFor(() => payloadHasEntity(ownerATasks.messages, 'tasks'));
  const ownerBSawTask = await waitFor(() => payloadHasEntity(ownerBTasks.messages, 'tasks'));
  check("the creating client's own profile channel receives a 'tasks' broadcast", Boolean(ownerASawTask));
  check("the SAME account's second real connection also receives it (multi-device sync)", Boolean(ownerBSawTask));
  check("a personal (non-family) task never broadcasts to the family channel", !payloadHasEntity(ownerAFamily.messages, 'tasks'));
  check("an unrelated adult's own profile channel never receives another profile's broadcast", !payloadHasEntity(adultProfile.messages, 'tasks'));

  console.log('== A family-visible event broadcasts to every current family member, never to an outsider ==');
  const eventMarker = `SECRET-MARKER-e2e-realtime-event-${STAMP}`;
  await adultClient.rpc('create_family_event', {
    p_family_id: familyId,
    p_title: eventMarker,
    p_starts_at: '2026-11-01T10:00:00+00:00',
    p_ends_at: '2026-11-01T11:00:00+00:00',
    p_timezone: 'UTC',
  });

  const ownerSawEvent = await waitFor(() => payloadHasEntity(ownerAFamily.messages, 'events'));
  const removedSawEvent = await waitFor(() => payloadHasEntity(removedFamily.messages, 'events'), 3000);
  check("an owner (family member) receives the family event broadcast", Boolean(ownerSawEvent));
  check("a still-active family member receives it too", Boolean(removedSawEvent));
  check("an outsider's (refused) channel never receives a family broadcast", outsiderFamilyAttempt.messages.length === 0);

  console.log('== A private, family-linked event broadcasts a generic signal only — never its title/description ==');
  const privateMarker = `SECRET-MARKER-e2e-realtime-private-${STAMP}`;
  await ownerA.rpc('create_personal_event', {
    p_title: privateMarker,
    p_starts_at: '2026-11-02T09:00:00+00:00',
    p_ends_at: '2026-11-02T10:00:00+00:00',
    p_timezone: 'UTC',
    p_description: privateMarker,
    p_visibility: 'private',
    p_family_id: familyId,
  });
  await waitFor(() => ownerAFamily.messages.length > 2, 4000); // let the broadcast (if any) land before sweeping

  console.log('== Removing a member: their EXISTING connection may keep working (a documented Supabase caching limitation), but a NEW subscribe attempt after removal must fail ==');
  await ownerA.rpc('remove_family_member', { p_member_id: removedMemberId });
  const secondEventMarker = `SECRET-MARKER-e2e-realtime-after-removal-${STAMP}`;
  await adultClient.rpc('create_family_event', {
    p_family_id: familyId,
    p_title: secondEventMarker,
    p_starts_at: '2026-11-03T10:00:00+00:00',
    p_ends_at: '2026-11-03T11:00:00+00:00',
    p_timezone: 'UTC',
  });
  const removedStillGotIt = await waitFor(
    () => removedFamily.messages.filter((message) => message?.entity === 'events').length >= 2,
    3000,
  );
  console.log(
    `  info - removed member's pre-existing connection ${removedStillGotIt ? 'DID' : 'did NOT'} still receive a post-removal broadcast (documented as an acceptable Supabase authorization-caching limitation either way — see docs/SECURITY_AND_PRIVACY.md, "Mechanism 3")`,
  );
  // A genuinely new connection (not the existing removedClient, whose
  // already-open channel object for this exact topic could just be reused
  // rather than re-authorized) — a fresh WebSocket, fresh session, signed
  // in as the same now-removed user, attempting a brand-new subscription.
  const removedFreshClient = newClient();
  await signIn(removedFreshClient, removed.email);
  const removedFreshAttempt = await subscribeTopic(removedFreshClient, `family:${familyId}`);
  check(
    'a removed member cannot open a brand-new subscription to the family channel after removal',
    removedFreshAttempt.status !== 'SUBSCRIBED',
  );
  await removedFreshClient.removeAllChannels();
  await removedFreshClient.auth.signOut();

  console.log('== Reconnect resumes sync: an unsubscribed-then-resubscribed channel keeps receiving broadcasts ==');
  await ownerA.removeChannel(ownerATasks.channel);
  const ownerAResubscribed = await subscribeTopic(ownerA, `profile:${ownerId}`);
  check('the resubscribed channel reaches SUBSCRIBED again', ownerAResubscribed.status === 'SUBSCRIBED');
  const reconnectMarker = `SECRET-MARKER-e2e-realtime-reconnect-${STAMP}`;
  await ownerA.rpc('create_personal_task', { p_title: reconnectMarker });
  const resumedSync = await waitFor(() => payloadHasEntity(ownerAResubscribed.messages, 'tasks'));
  check('after reconnecting, the channel resumes receiving real broadcasts', Boolean(resumedSync));

  console.log('== A rapid burst of mutations never errors the connection or drops a message ==');
  const beforeBurst = ownerAResubscribed.messages.length;
  await Promise.all([
    ownerA.rpc('create_personal_task', { p_title: `${reconnectMarker}-burst-1` }),
    ownerA.rpc('create_personal_task', { p_title: `${reconnectMarker}-burst-2` }),
  ]);
  await waitFor(() => ownerAResubscribed.messages.length > beforeBurst, 4000);
  check('a rapid burst of two real mutations is received without a channel error', ownerAResubscribed.status === 'SUBSCRIBED');

  console.log('== Secret-marker sweep: no title/description ever appears in any broadcast payload, on any channel ==');
  const allCollected = [
    ...ownerATasks.messages,
    ...ownerAFamily.messages,
    ...ownerBTasks.messages,
    ...adultProfile.messages,
    ...adultFamily.messages,
    ...outsiderProfile.messages,
    ...outsiderFamilyAttempt.messages,
    ...removedFamily.messages,
    ...ownerAResubscribed.messages,
  ];
  for (const marker of [taskMarker, eventMarker, privateMarker, secondEventMarker, reconnectMarker]) {
    check(`marker "${marker}" never appears in any collected broadcast payload`, !rawContains(allCollected, marker));
  }
  check(
    'every collected payload is exactly the generic {version, scope, entity, operation} shape (plus realtime.send\'s own id)',
    allCollected.every((message) => {
      const keys = Object.keys(message ?? {}).sort();
      return JSON.stringify(keys) === JSON.stringify(['entity', 'id', 'operation', 'scope', 'version'].sort());
    }),
  );

  console.log('== Cleanup ==');
  for (const client of [ownerA, ownerB, adultClient, outsiderClient, removedClient]) {
    await client.removeAllChannels();
    await client.auth.signOut();
  }
  for (const uid of createdUserIds) {
    const { error: tasksError } = await adminClient.from('tasks').delete().eq('owner_profile_id', uid);
    if (tasksError) console.warn(`cleanup: failed to delete tasks for ${uid}`, tasksError.message);
    const { error: eventsError } = await adminClient.from('events').delete().eq('owner_profile_id', uid);
    if (eventsError) console.warn(`cleanup: failed to delete events for ${uid}`, eventsError.message);
  }
  if (familyId) {
    const { error: familyError2 } = await adminClient.from('families').delete().eq('id', familyId);
    if (familyError2) console.warn('cleanup: failed to delete family', familyError2.message);
  }
  for (const uid of createdUserIds) {
    const { error: userError } = await adminClient.auth.admin.deleteUser(uid);
    if (userError) console.warn(`cleanup: failed to delete user ${uid}`, userError.message);
  }

  console.log('\n==================================================');
  console.log(`Real Realtime WebSocket integration: ${passed} passed, ${failed} failed`);
  console.log('==================================================');
  if (failed > 0) {
    console.log('Failures:');
    for (const label of failures) console.log(`  - ${label}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
