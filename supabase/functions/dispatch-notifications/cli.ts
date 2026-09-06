// Manual/scripted invocation of dispatchNotifications() against a REAL
// local Postgres instance, using a FAKE Expo transport — never a real
// network send. Backs scripts/e2e-notifications.sh (see that script for
// the full flow this supports); not used by the deployed Edge Function
// itself (see index.ts's own Deno.serve entry point for that).
//
// Usage: SUPABASE_DB_URL=... deno run --allow-net --allow-env cli.ts [--fail-token=<expo_push_token>]
//
// Refuses to run against anything but a local database, independent of
// (and in addition to) the bash caller's own safety gate — this file has
// no way to know its caller actually checked, so it checks again itself.
import { createDbClient } from "../_shared/db.ts";
import type { ExpoPushMessage, ExpoTicket, PushTransport } from "../_shared/expoTransport.ts";
import { dispatchNotifications } from "./index.ts";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) {
  console.error("SUPABASE_DB_URL is not set");
  Deno.exit(1);
}
if (!/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(dbUrl)) {
  console.error(`Refusing to run: SUPABASE_DB_URL does not point at localhost/127.0.0.1 (${dbUrl})`);
  Deno.exit(1);
}

const failTokenArg = Deno.args.find((a) => a.startsWith("--fail-token="));
const failToken = failTokenArg ? failTokenArg.slice("--fail-token=".length) : null;

// Records every batch it was asked to "send" (for the bash caller's own
// assertions, printed alongside the dispatch result) but never performs
// any network I/O — this is the fixed fake described throughout Section
// 10 of the Phase 6 brief, not a configurable-by-accident real transport.
class FakeTransport implements PushTransport {
  sentBatches: ExpoPushMessage[][] = [];

  sendBatch(messages: ExpoPushMessage[]): Promise<ExpoTicket[]> {
    this.sentBatches.push(messages);
    return Promise.resolve(
      messages.map((m) =>
        failToken && m.to === failToken
          ? { status: "error" as const, message: "device not registered", details: { error: "DeviceNotRegistered" } }
          : { status: "ok" as const, id: crypto.randomUUID() },
      ),
    );
  }

  getReceipts(): Promise<Record<string, never>> {
    // Not exercised here — the dispatcher only checks receipts for
    // tickets already in ticket_ok status, and this CLI runs once per
    // invocation rather than looping until receipts are ready.
    return Promise.resolve({});
  }
}

const sql = createDbClient();
try {
  const transport = new FakeTransport();
  const result = await dispatchNotifications(sql, transport, 50, "e2e-notifications-cli");
  console.log(JSON.stringify({ result, sentMessageCount: transport.sentBatches.flat().length }));
} finally {
  await sql.end();
}
