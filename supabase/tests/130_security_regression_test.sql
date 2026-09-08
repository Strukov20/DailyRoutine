-- Security regression guard (Phase 6.1, Section 13): a durable, schema-driven
-- CI gate for the anon-EXECUTE-grant class of finding that has recurred
-- across Phase 3 (two invitation RPCs), Phase 5 (set_task_assignment), and
-- Phase 6 (enqueue_task_assignment_notification, backoff_interval) — every
-- one of those was only ever caught by hand-running a pg_proc/
-- has_function_privilege query against a real instance, never by this test
-- suite itself, because no automated check for the *general* invariant
-- existed yet. This file is that check.
--
-- Deliberately an *invariant* check, not a snapshot of every grant in the
-- database (see the brief's own "do not snapshot all grants if it creates
-- a fragile test — check the actual security invariants" instruction): a
-- snapshot would need editing every time a legitimate new function is
-- added, training whoever touches it next to "just update the list" rather
-- than actually verifying safety. Instead, this queries pg_proc/pg_namespace
-- directly (never a hardcoded function list) and asserts a property that
-- should hold for *any* function, present or future:
--
--   1. anon may EXECUTE a function in public/notifications only if that
--      function is either (a) a trigger function — Postgres refuses to
--      invoke a `returns trigger` function outside a trigger context
--      regardless of any EXECUTE grant, so a grant there is inert — or
--      (b) explicitly named in a short, reviewed whitelist below.
--   2. The PUBLIC pseudo-role (Postgres's own default EXECUTE grant at
--      function-creation time, separate from anon/authenticated's own
--      Supabase-bootstrap grants — see docs/DECISIONS.md, "Phase 3") is
--      held to the same rule.
--   3. The `notifications` schema specifically (Section "notifications
--      schema" in docs/DATA_MODEL.md) allows zero EXECUTE for anon,
--      authenticated, or PUBLIC on anything, trigger or not — that schema
--      has no legitimate direct-call surface for any client role at all.
begin;
select plan(6);

-- ---------------------------------------------------------------------------
-- 1. anon: no EXECUTE on any non-trigger function in public/notifications
--    beyond the documented whitelist.
--
--    Whitelist and why each entry is safe:
--      public.current_profile_id() — `select auth.uid()`, not
--        SECURITY DEFINER, returns null for anon (no session), no side
--        effects, no data access. Reviewed and accepted, not an oversight.
-- ---------------------------------------------------------------------------
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'notifications')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and pg_get_function_result(p.oid) <> 'trigger'
      and (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
        not in ('public.current_profile_id()')
  ),
  0,
  'anon has EXECUTE on no non-trigger function beyond the documented whitelist (current_profile_id only)'
);

-- ---------------------------------------------------------------------------
-- 2. Trigger functions are genuinely safe despite the grant: Postgres
--    itself refuses to invoke one directly, independent of privilege.
--    Proves the exemption in check 1 isn't just asserted but actually
--    holds, using one of the real trigger functions anon currently has
--    EXECUTE on.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.set_updated_at() $$,
  '0A000',
  null,
  'a trigger function cannot be invoked directly even with EXECUTE granted (Postgres-level protection, not this codebase''s)'
);

-- ---------------------------------------------------------------------------
-- 3. PUBLIC pseudo-role held to the same rule as anon (check 1) — this is
--    the mechanism Postgres itself uses to auto-grant EXECUTE at function
--    creation time, separate from anon/authenticated's own Supabase-
--    bootstrap grants (see docs/DECISIONS.md, "Phase 3").
-- ---------------------------------------------------------------------------
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'notifications')
      and has_function_privilege('public', p.oid, 'EXECUTE')
      and pg_get_function_result(p.oid) <> 'trigger'
      and (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
        not in ('public.current_profile_id()')
  ),
  0,
  'the PUBLIC pseudo-role has EXECUTE on no non-trigger function beyond the same documented whitelist'
);

-- ---------------------------------------------------------------------------
-- 4-6. The `notifications` schema allows zero EXECUTE for anon,
--    authenticated, or PUBLIC on *anything* — trigger functions included,
--    since even a trigger function's mere existence/name should not be
--    directly reachable there. No whitelist for this schema at all.
-- ---------------------------------------------------------------------------
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'notifications'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  0,
  'anon has EXECUTE on nothing at all in the notifications schema'
);
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'notifications'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  0,
  'authenticated has EXECUTE on nothing at all in the notifications schema'
);
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'notifications'
      and has_function_privilege('public', p.oid, 'EXECUTE')
  ),
  0,
  'the PUBLIC pseudo-role has EXECUTE on nothing at all in the notifications schema'
);

select * from finish();
rollback;
