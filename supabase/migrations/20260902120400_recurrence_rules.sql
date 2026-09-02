-- recurrence_rules: referenced by tasks and events. See docs/DATA_MODEL.md.
--
-- Not directly exposed to PostgREST this phase — there is no task/event CRUD
-- UI yet (see docs/MVP_SCOPE.md), so nothing needs to query this table on
-- its own. When Phase 3 builds task/event CRUD, recurrence data should be
-- embedded via the tasks/events read APIs rather than fetched separately;
-- if a standalone accessor turns out to be needed, add narrow RLS then
-- rather than opening broad direct access speculatively now.

create table public.recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  interval integer not null default 1 check (interval > 0),
  by_weekday integer[] check (
    by_weekday is null or (
      by_weekday <@ array[0, 1, 2, 3, 4, 5, 6]
    )
  ),
  until date,
  -- Recurrence needs a fixed timezone anchor to compute future occurrences
  -- correctly across DST — see docs/DATA_MODEL.md addendum in
  -- docs/DECISIONS.md ("Timezone handling").
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

comment on table public.recurrence_rules is
  'Recurrence pattern referenced by tasks.recurrence_rule_id / events.recurrence_rule_id. '
  'Not directly exposed via the API this phase — read through the owning task/event.';

create trigger set_recurrence_rules_updated_at
  before update on public.recurrence_rules
  for each row
  execute function public.set_updated_at();

alter table public.recurrence_rules enable row level security;
alter table public.recurrence_rules force row level security;
revoke all on public.recurrence_rules from anon, authenticated;
-- Deliberately no policies and no grants yet: nothing may access this table
-- directly through the Data API this phase. See supabase/tests for a test
-- proving this (a locked-down table with zero grants is still worth an
-- explicit regression test, so a future migration can't loosen it by
-- accident without the test suite noticing).
