// Deterministic tests for the dispatcher against a REAL local Postgres
// instance (matching this project's "no privacy/security-relevant test
// runs against a mock" philosophy — see docs/TEST_STRATEGY.md) with a FAKE
// Expo transport (matching "automated tests must not send real external
// push notifications"). Requires the local Supabase stack running
// (npm run supabase:start && npm run db:reset) — reads SUPABASE_DB_URL the
// same way scripts/e2e-backend.sh reads its own credentials: dynamically,
// never hardcoded.
//
// Run: deno test --allow-net --allow-env supabase/functions/dispatch-notifications/index.test.ts
import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import postgres from "npm:postgres@3.4.4";
import { dispatchNotifications } from "./index.ts";
import type { ExpoPushMessage, ExpoTicket, ExpoReceipt, PushTransport } from "../_shared/expoTransport.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/^postgresql:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) {
  throw new Error("Refusing to run: SUPABASE_DB_URL does not point at 127.0.0.1/localhost.");
}

/** A fully scriptable fake transport — never touches the network. */
class FakeTransport implements PushTransport {
  sendCalls: ExpoPushMessage[][] = [];
  receiptCalls: string[][] = [];
  nextTickets: ExpoTicket[] | (() => ExpoTicket[]) | null = null;
  sendShouldThrow = false;
  nextReceipts: Record<string, ExpoReceipt> | (() => Record<string, ExpoReceipt>) = {};
  receiptsShouldThrow = false;

  sendBatch(messages: ExpoPushMessage[]): Promise<ExpoTicket[]> {
    this.sendCalls.push(messages);
    if (this.sendShouldThrow) return Promise.reject(new Error("simulated network timeout"));
    const tickets = typeof this.nextTickets === "function" ? this.nextTickets() : this.nextTickets;
    return Promise.resolve(tickets ?? messages.map(() => ({ status: "ok" as const, id: crypto.randomUUID() })));
  }

  getReceipts(ticketIds: string[]): Promise<Record<string, ExpoReceipt>> {
    this.receiptCalls.push(ticketIds);
    if (this.receiptsShouldThrow) return Promise.reject(new Error("simulated receipt-fetch timeout"));
    const receipts = typeof this.nextReceipts === "function" ? this.nextReceipts() : this.nextReceipts;
    return Promise.resolve(receipts);
  }
}

async function withFixture(
  t: Deno.TestContext,
  sql: ReturnType<typeof postgres>,
  fn: (ctx: {
    familyId: string;
    ownerMemberId: string;
    ownerProfileId: string;
    recipientMemberId: string;
    recipientProfileId: string;
    taskId: string;
  }) => Promise<void>,
) {
  const ownerId = crypto.randomUUID();
  const recipientId = crypto.randomUUID();
  await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token)
    values
      ('00000000-0000-0000-0000-000000000000', ${ownerId}, 'authenticated', 'authenticated', ${"dispatch-owner-" + ownerId + "@test.local"}, 'x', now(), now(), now(), '{}', '{}', false, ''),
      ('00000000-0000-0000-0000-000000000000', ${recipientId}, 'authenticated', 'authenticated', ${"dispatch-recipient-" + recipientId + "@test.local"}, 'x', now(), now(), now(), '{}', '{}', false, '')
  `;
  const [family] = await sql`
    insert into public.families (name, owner_id, created_by) values ('Dispatch Test Family', ${ownerId}, ${ownerId}) returning id
  `;
  const [ownerMember] = await sql`
    insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
    values (${family.id}, 'adult', 'owner', ${ownerId}, 'Owner', ${ownerId}) returning id
  `;
  const [recipientMember] = await sql`
    insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
    values (${family.id}, 'adult', 'adult', ${recipientId}, 'Recipient', ${ownerId}) returning id
  `;
  const [task] = await sql`
    insert into public.tasks (owner_profile_id, family_id, title, visibility, created_by)
    values (${ownerId}, ${family.id}, 'Dispatch test task', 'family', ${ownerId}) returning id
  `;

  try {
    await fn({
      familyId: family.id,
      ownerMemberId: ownerMember.id,
      ownerProfileId: ownerId,
      recipientMemberId: recipientMember.id,
      recipientProfileId: recipientId,
      taskId: task.id,
    });
  } finally {
    // task_assignments has two composite FKs to family_members
    // (assigned_to/assigned_by_same_family) with no ON DELETE clause, so
    // deleting `families` directly first (relying on ITS cascade to
    // family_members) 409s — task_assignments must go first. Deleting
    // `tasks` cascades task_assignments (task_id has ON DELETE CASCADE),
    // which is enough; `families` then cascades tasks/family_members/
    // notifications.outbox/deliveries cleanly. Same FK chain already
    // documented in scripts/e2e-backend.sh's own cleanup.
    await sql`delete from public.tasks where family_id = ${family.id}`;
    await sql`delete from public.families where id = ${family.id}`;
    await sql`delete from auth.users where id in (${ownerId}, ${recipientId})`;
  }
}

Deno.test("dispatch-notifications", async (t) => {
  const sql = postgres(DB_URL, { max: 2 });

  try {
    await t.step("successful Expo ticket -> delivery ticket_ok, outbox sent", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${"ExponentPushToken[ok-" + ctx.recipientProfileId + "]"}, 'ios')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        assertEquals(result.claimed, 1);
        assertEquals(result.sent, 1);
        assertEquals(result.deliveriesAttempted, 1);

        const [outbox] = await sql`select status from notifications.outbox where task_id = ${ctx.taskId}`;
        assertEquals(outbox.status, "sent");
        const [delivery] = await sql`select d.status, expo_ticket_id from notifications.deliveries d join notifications.outbox o on o.id = d.outbox_id where o.task_id = ${ctx.taskId}`;
        assertEquals(delivery.status, "ticket_ok");
        assertExists(delivery.expo_ticket_id);
      });
    });

    await t.step("ticket rejection (generic error) -> delivery ticket_error, token stays active", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${"ExponentPushToken[reject-" + ctx.recipientProfileId + "]"}, 'ios')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        transport.nextTickets = [{ status: "error", message: "boom", details: { error: "ProviderError" } }];
        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        assertEquals(result.sent, 1); // send call itself succeeded — per-device outcome is tracked separately
        const [delivery] = await sql`select d.status, error_code from notifications.deliveries d join notifications.outbox o on o.id = d.outbox_id where o.task_id = ${ctx.taskId}`;
        assertEquals(delivery.status, "ticket_error");
        assertEquals(delivery.error_code, "ProviderError");
        const [token] = await sql`select deactivated_at from public.notification_tokens where profile_id = ${ctx.recipientProfileId}`;
        assertEquals(token.deactivated_at, null);
      });
    });

    await t.step("DeviceNotRegistered ticket -> token deactivated immediately", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${"ExponentPushToken[dnr-" + ctx.recipientProfileId + "]"}, 'android')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        transport.nextTickets = [{ status: "error", details: { error: "DeviceNotRegistered" } }];
        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        assertEquals(result.deliveriesDeactivatedTokens, 1);
        const [token] = await sql`select deactivated_at from public.notification_tokens where profile_id = ${ctx.recipientProfileId}`;
        assertExists(token.deactivated_at);
      });
    });

    await t.step("timeout/network failure on send -> outbox rescheduled pending, not failed", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${"ExponentPushToken[timeout-" + ctx.recipientProfileId + "]"}, 'ios')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        transport.sendShouldThrow = true;
        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        assertEquals(result.sent, 0);
        assertEquals(result.failed, 0); // first attempt — not yet exhausted
        const [outbox] = await sql`select status, next_attempt_at, last_error from notifications.outbox where task_id = ${ctx.taskId}`;
        assertEquals(outbox.status, "pending");
        assertExists(outbox.last_error);
      });
    });

    await t.step("malformed provider response -> treated as a thrown transport error (retryable)", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${"ExponentPushToken[malformed-" + ctx.recipientProfileId + "]"}, 'ios')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        // Simulate the real transport's own malformed-shape guard by
        // rejecting, exactly as createExpoTransport() would after failing
        // its own shape check.
        transport.nextTickets = (() => {
          throw new Error("Expo push send returned an unexpected ticket shape");
        }) as unknown as ExpoTicket[];
        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        assertEquals(result.sent, 0);
        const [outbox] = await sql`select status from notifications.outbox where task_id = ${ctx.taskId}`;
        assertEquals(outbox.status, "pending");
      });
    });

    await t.step("receipt success -> delivery receipt_ok", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${"ExponentPushToken[receipt-ok-" + ctx.recipientProfileId + "]"}, 'ios')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        const ticketId = crypto.randomUUID();
        transport.nextTickets = [{ status: "ok", id: ticketId }];
        transport.nextReceipts = { [ticketId]: { status: "ok" } };

        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        assertEquals(result.receiptsOk, 1);
        const [delivery] = await sql`select d.status from notifications.deliveries d join notifications.outbox o on o.id = d.outbox_id where o.task_id = ${ctx.taskId}`;
        assertEquals(delivery.status, "receipt_ok");
      });
    });

    await t.step("transient receipt error -> delivery receipt_error, token untouched", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${"ExponentPushToken[receipt-transient-" + ctx.recipientProfileId + "]"}, 'ios')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        const ticketId = crypto.randomUUID();
        transport.nextTickets = [{ status: "ok", id: ticketId }];
        transport.nextReceipts = { [ticketId]: { status: "error", details: { error: "ProviderError" } } };

        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        assertEquals(result.receiptsFailed, 1);
        const [delivery] = await sql`select d.status, error_code from notifications.deliveries d join notifications.outbox o on o.id = d.outbox_id where o.task_id = ${ctx.taskId}`;
        assertEquals(delivery.status, "receipt_error");
        assertEquals(delivery.error_code, "ProviderError");
        const [token] = await sql`select deactivated_at from public.notification_tokens where profile_id = ${ctx.recipientProfileId}`;
        assertEquals(token.deactivated_at, null);
      });
    });

    await t.step("permanent receipt error (DeviceNotRegistered) -> token deactivated", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${"ExponentPushToken[receipt-dnr-" + ctx.recipientProfileId + "]"}, 'ios')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        const ticketId = crypto.randomUUID();
        transport.nextTickets = [{ status: "ok", id: ticketId }];
        transport.nextReceipts = { [ticketId]: { status: "error", details: { error: "DeviceNotRegistered" } } };

        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        assertEquals(result.deliveriesDeactivatedTokens, 1);
        const [token] = await sql`select deactivated_at from public.notification_tokens where profile_id = ${ctx.recipientProfileId}`;
        assertExists(token.deactivated_at);
      });
    });

    await t.step("no active tokens -> outbox skipped, no send attempted", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        assertEquals(result.skipped, 1);
        assertEquals(transport.sendCalls.length, 0);
        const [outbox] = await sql`select status from notifications.outbox where task_id = ${ctx.taskId}`;
        assertEquals(outbox.status, "skipped");
      });
    });

    await t.step("concurrent claim: two simultaneous claims never return the same row", async () => {
      await withFixture(t, sql, async (ctx) => {
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${"ExponentPushToken[concurrent-" + ctx.recipientProfileId + "]"}, 'ios')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        // FOR UPDATE SKIP LOCKED needs each claim on its own connection/
        // transaction to actually race — a single `postgres()` client
        // serializes statements on one session, so open two.
        const sqlA = postgres(DB_URL, { max: 1 });
        const sqlB = postgres(DB_URL, { max: 1 });
        try {
          const [claimedA, claimedB] = await Promise.all([
            sqlA`select * from notifications.claim_pending_outbox('worker-a', 20)`,
            sqlB`select * from notifications.claim_pending_outbox('worker-b', 20)`,
          ]);
          const idsA = new Set((claimedA as unknown as { id: string }[]).map((r) => r.id));
          const idsB = (claimedB as unknown as { id: string }[]).map((r) => r.id);
          for (const id of idsB) {
            assertEquals(idsA.has(id), false, "the same outbox row must never be claimed by two concurrent workers");
          }
          assertEquals(idsA.size + idsB.length >= 1, true, "at least one worker claimed the row");
        } finally {
          await sqlA.end();
          await sqlB.end();
        }
      });
    });

    await t.step("redacted logging: dispatch result never contains the raw push token", async () => {
      await withFixture(t, sql, async (ctx) => {
        const rawToken = "ExponentPushToken[should-never-appear-in-result]";
        await sql`insert into public.notification_tokens (profile_id, expo_push_token, device_platform) values (${ctx.recipientProfileId}, ${rawToken}, 'ios')`;
        await sql`insert into public.task_assignments (task_id, assigned_to_member_id, assigned_by_member_id, action) values (${ctx.taskId}, ${ctx.recipientMemberId}, ${ctx.ownerMemberId}, 'assigned')`;

        const transport = new FakeTransport();
        const result = await dispatchNotifications(sql, transport, 20, "test-worker");

        const serialized = JSON.stringify(result);
        assertEquals(serialized.includes(rawToken), false);
        assertEquals(serialized.includes("should-never-appear"), false);
      });
    });
  } finally {
    await sql.end();
  }
});
