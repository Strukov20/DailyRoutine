// Dispatches pending shared-family-task assignment push notifications.
//
// Invocation: designed to be triggered two ways, both preserving the
// outbox as the sole source of truth so a failed invocation of either
// never loses work:
//   1. A Supabase Database Webhook on `notifications.outbox` INSERT, for
//      low-latency delivery right after a task assignment.
//   2. A scheduled sweep (pg_cron calling this function on a short
//      interval, e.g. every minute) as a durable fallback that picks up
//      anything the webhook missed (a cold start, a transient network
//      failure, or the webhook simply not firing) — outbox rows stay
//      `pending` until a claim succeeds, so nothing is lost either way.
// Neither mechanism was deployed this session (see docs/DECISIONS.md,
// "Phase 6" for the exact manual step) — both invocation paths call this
// same handler, so wiring either up later is a Supabase dashboard/CLI
// configuration step, not a code change.
//
// Authorization: rejects any request without the correct
// NOTIFICATION_WORKER_SECRET header, independent of Supabase's own
// platform-level JWT verification (which this function additionally
// expects to run behind in a real deployment) — a secret this code
// controls and can verify in a local test, not just a deploy-time flag.
import { createDbClient } from "../_shared/db.ts";
import {
  chunk,
  classifyExpoError,
  createExpoTransport,
  EXPO_MAX_MESSAGES_PER_SEND,
  EXPO_MAX_TICKETS_PER_RECEIPT_REQUEST,
  isValidExpoPushToken,
  type ExpoPushMessage,
  type PushTransport,
} from "../_shared/expoTransport.ts";

const DEFAULT_CLAIM_LIMIT = 20;

// Privacy-safe, static lock-screen text — never a title/description/name.
// See docs/SECURITY_AND_PRIVACY.md, Mechanism 4.
const NOTIFICATION_TITLE = "FamilyFlow";
const NOTIFICATION_BODY_BY_EVENT: Record<string, string> = {
  "family_task.assignment_requested.v1": "New family task assigned",
  "family_task.assignment_accepted.v1": "Your task assignment was accepted",
  "family_task.assignment_declined.v1": "Your task assignment was declined",
  "family_task.assignment_taken.v1": "Someone took a family task",
  // Phase 7 — event responsibilities (drop-off/pick-up/etc.). Same static,
  // content-free body discipline as the task events above.
  "event_responsibility.assignment_requested.v1": "New event responsibility assigned",
  "event_responsibility.assignment_accepted.v1": "Your responsibility was accepted",
  "event_responsibility.assignment_declined.v1": "Your responsibility was declined",
  "event_responsibility.assignment_taken.v1": "Someone took an event responsibility",
};

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  deliveriesAttempted: number;
  deliveriesDeactivatedTokens: number;
  receiptsChecked: number;
  receiptsOk: number;
  receiptsFailed: number;
}

export async function dispatchNotifications(
  // deno-lint-ignore no-explicit-any
  sql: any,
  transport: PushTransport,
  limit: number = DEFAULT_CLAIM_LIMIT,
  workerId: string = crypto.randomUUID(),
): Promise<DispatchResult> {
  const result: DispatchResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    deliveriesAttempted: 0,
    deliveriesDeactivatedTokens: 0,
    receiptsChecked: 0,
    receiptsOk: 0,
    receiptsFailed: 0,
  };

  // --- Phase 1: claim + send new tickets ---------------------------------
  const claimed = await sql`select * from notifications.claim_pending_outbox(${workerId}, ${limit})`;
  result.claimed = claimed.length;

  for (const row of claimed) {
    const recipientProfile = await sql`
      select fm.profile_id
      from public.family_members fm
      where fm.id = ${row.recipient_member_id}
    `;
    const recipientProfileId = recipientProfile[0]?.profile_id;

    const tokens = recipientProfileId
      ? await sql`
          select id, expo_push_token
          from public.notification_tokens
          where profile_id = ${recipientProfileId} and deactivated_at is null
        `
      : [];

    const validTokens = tokens.filter((t: { expo_push_token: string }) => isValidExpoPushToken(t.expo_push_token));

    if (validTokens.length === 0) {
      await sql`select notifications.finish_outbox_attempt(${row.id}, 'skipped', 'no active/valid tokens for recipient')`;
      result.skipped += 1;
      continue;
    }

    // Pre-create delivery rows so even a crash mid-send leaves a
    // traceable pending row per device, per outbox event.
    const deliveryIds: string[] = [];
    for (const token of validTokens) {
      const inserted = await sql`
        insert into notifications.deliveries (outbox_id, notification_token_id, status)
        values (${row.id}, ${token.id}, 'pending')
        on conflict (outbox_id, notification_token_id) do update set status = 'pending'
        returning id
      `;
      deliveryIds.push(inserted[0].id);
    }

    const body = NOTIFICATION_BODY_BY_EVENT[row.event_type] ?? "Family task update";
    const messages: ExpoPushMessage[] = validTokens.map((t: { expo_push_token: string }) => ({
      to: t.expo_push_token,
      title: NOTIFICATION_TITLE,
      body,
      data: row.payload,
    }));

    try {
      const batches = chunk(messages, EXPO_MAX_MESSAGES_PER_SEND);
      let ticketIndex = 0;
      for (const batch of batches) {
        const tickets = await transport.sendBatch(batch);
        for (const ticket of tickets) {
          const deliveryId = deliveryIds[ticketIndex];
          ticketIndex += 1;
          result.deliveriesAttempted += 1;

          if (ticket.status === "ok" && ticket.id) {
            await sql`
              update notifications.deliveries
              set status = 'ticket_ok', expo_ticket_id = ${ticket.id}, attempts = attempts + 1
              where id = ${deliveryId}
            `;
            continue;
          }

          const errorCode = ticket.details?.error;
          const errorClass = classifyExpoError(errorCode);
          if (errorClass === "device_not_registered") {
            await sql`select notifications.deactivate_notification_token(${validTokens[ticketIndex - 1].id})`;
            result.deliveriesDeactivatedTokens += 1;
          }
          await sql`
            update notifications.deliveries
            set status = 'ticket_error', error_code = ${errorCode ?? "unknown"}, attempts = attempts + 1
            where id = ${deliveryId}
          `;
        }
      }

      // The outbox's job is "attempted delivery", not "every device
      // confirmed" — per-device outcomes live in notifications.deliveries.
      // A send call that returns (even with some per-ticket errors) means
      // this outbox row is done; a send call that *throws* below is a
      // transport-level failure, retried at the outbox level instead.
      await sql`select notifications.finish_outbox_attempt(${row.id}, 'sent')`;
      result.sent += 1;
    } catch (err) {
      // Network/timeout/malformed-response — retryable at the outbox
      // level (bounded backoff, not immediate/unbounded).
      const message = err instanceof Error ? err.message : "unknown transport error";
      const isExhausted = row.attempts >= 5;
      await sql`select notifications.finish_outbox_attempt(${row.id}, ${isExhausted ? "failed" : "pending"}, ${message})`;
      if (isExhausted) {
        result.failed += 1;
      }
    }
  }

  // --- Phase 2: check receipts for outstanding tickets --------------------
  const pendingReceipts = await sql`
    select id, expo_ticket_id, notification_token_id
    from notifications.deliveries
    where status = 'ticket_ok' and expo_ticket_id is not null
  `;
  result.receiptsChecked = pendingReceipts.length;

  if (pendingReceipts.length > 0) {
    const byTicketId = new Map<string, { id: string; notification_token_id: string }>(
      pendingReceipts.map((d: { expo_ticket_id: string; id: string; notification_token_id: string }) => [d.expo_ticket_id, d]),
    );
    const idBatches: string[][] = chunk(
      pendingReceipts.map((d: { expo_ticket_id: string }) => d.expo_ticket_id) as string[],
      EXPO_MAX_TICKETS_PER_RECEIPT_REQUEST,
    );

    for (const idBatch of idBatches) {
      let receipts: Record<string, { status: string; details?: { error?: string } }>;
      try {
        receipts = await transport.getReceipts(idBatch);
      } catch {
        // Transport failure while checking receipts — leave these
        // deliveries as ticket_ok, they'll be re-checked next invocation.
        continue;
      }

      for (const ticketId of idBatch) {
        const receipt = receipts[ticketId];
        if (!receipt) continue; // not ready yet
        const delivery = byTicketId.get(ticketId) as { id: string; notification_token_id: string };

        if (receipt.status === "ok") {
          await sql`update notifications.deliveries set status = 'receipt_ok', attempts = attempts + 1 where id = ${delivery.id}`;
          result.receiptsOk += 1;
          continue;
        }

        const errorCode = receipt.details?.error;
        const errorClass = classifyExpoError(errorCode);
        if (errorClass === "device_not_registered") {
          await sql`select notifications.deactivate_notification_token(${delivery.notification_token_id})`;
          result.deliveriesDeactivatedTokens += 1;
        }
        await sql`
          update notifications.deliveries
          set status = 'receipt_error', error_code = ${errorCode ?? "unknown"}, attempts = attempts + 1
          where id = ${delivery.id}
        `;
        result.receiptsFailed += 1;
      }
    }
  }

  return result;
}

// deno-lint-ignore no-explicit-any
declare const Deno: any;

// import.meta.main is true only when this file is the entry point (the
// real Edge Function runtime invocation) — false when another module
// (the test file) imports dispatchNotifications, so importing this file
// for testing never starts a real HTTP listener as a side effect.
if (typeof Deno !== "undefined" && Deno.serve && import.meta.main) {
  Deno.serve(async (req: Request) => {
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    const expectedSecret = Deno.env.get("NOTIFICATION_WORKER_SECRET");
    const providedSecret = req.headers.get("x-notification-worker-secret");
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return new Response("unauthorized", { status: 401 });
    }

    let limit = DEFAULT_CLAIM_LIMIT;
    try {
      const body = await req.json();
      if (typeof body?.limit === "number" && body.limit > 0) {
        limit = Math.min(body.limit, 100);
      }
    } catch {
      // no/invalid JSON body — use the default limit.
    }

    const sql = createDbClient();
    try {
      const result = await dispatchNotifications(sql, createExpoTransport(), limit);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      // Never log the request body or any token — only the error message,
      // which is developer-authored (this codebase's own thrown Errors),
      // never provider/user content.
      console.error("dispatch-notifications failed", err instanceof Error ? err.message : String(err));
      return new Response(JSON.stringify({ error: "internal error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    } finally {
      await sql.end();
    }
  });
}
