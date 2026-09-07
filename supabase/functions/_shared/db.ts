// Direct Postgres connection for the notification dispatcher.
//
// Why not the Supabase JS client / PostgREST: `notifications.outbox` and
// `notifications.deliveries` live in a schema that is deliberately NOT in
// supabase/config.toml's `[api] schemas` list — PostgREST exposes no
// endpoint for that schema at all, to any role, regardless of grants (this
// is a routing-level restriction, not a permission one, so service_role's
// usual RLS/grant bypass does not reach it). A direct connection using the
// project's DB_URL (service-role-equivalent Postgres access, read from
// SUPABASE_DB_URL — a server-only secret, never EXPO_PUBLIC_*, never in the
// mobile bundle) is the standard way to reach an internal schema from an
// Edge Function.
import postgres from "npm:postgres@3.4.4";

export type Sql = ReturnType<typeof postgres>;

export function createDbClient(): Sql {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    throw new Error("SUPABASE_DB_URL is not set");
  }
  return postgres(dbUrl, { max: 4 });
}

export interface OutboxRow {
  id: string;
  event_type: string;
  family_id: string;
  task_id: string;
  recipient_member_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface ActiveTokenRow {
  id: string;
  expo_push_token: string;
}
