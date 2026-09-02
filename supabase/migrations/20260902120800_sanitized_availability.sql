-- Sanitized availability: the "Busy block" mechanism.
--
-- See docs/SECURITY_AND_PRIVACY.md, Mechanism 2, and docs/DECISIONS.md
-- ("Privacy view implementation: not security_invoker") for why this is
-- built the way it is below — implementing it surfaced a real gap in the
-- Phase 1 proposal that is documented there rather than silently patched.
--
-- Summary of the corrected design: `events`/`tasks` base-table RLS (previous
-- migrations) lets a non-owner SELECT a row *at all* only when
-- visibility = 'family' — a private row is completely invisible via the
-- base table to anyone but its owner. That means a plain security_invoker
-- view gains nothing extra: RLS would already filter private rows out
-- before the view's column-sanitizing CASE expressions ever ran, so no
-- Busy block could ever appear for a private item.
--
-- These views are therefore *not* security_invoker. As ordinary views owned
-- by the migration role (which owns the underlying tables), they execute
-- with the owner's privileges and bypass the querying user's RLS on
-- `events`/`tasks` — which means the view's own WHERE clause is the *only*
-- authorization check protecting it. That WHERE clause (same-family
-- membership) and the CASE-based column sanitization are reviewed together
-- here, in one place, so "what a family member is allowed to see" has
-- exactly one definition.

create view public.family_schedule as
select
  e.id,
  e.family_id,
  e.owner_profile_id,
  e.starts_at,
  e.ends_at,
  e.visibility,
  case when e.visibility = 'family' then e.title else null end as title,
  case when e.visibility = 'family' then e.description else null end as description,
  case when e.visibility = 'family' then e.location else null end as location
from public.events e
where
  e.family_id is not null
  and e.family_id in (
    select fm.family_id from public.family_members fm where fm.profile_id = auth.uid()
  );

comment on view public.family_schedule is
  'Family-visible schedule: full content for visibility=family events, sanitized '
  '(owner/start/end only — "Busy") for private ones. Authorization lives entirely in this '
  'view''s WHERE clause — see the migration header comment for why this is not a '
  'security_invoker view. Never add columns here without checking whether they belong in '
  'the CASE-sanitized set.';

create view public.family_task_board as
select
  t.id,
  t.family_id,
  t.owner_profile_id,
  t.date,
  t.start_time,
  t.duration_minutes,
  t.timezone,
  t.visibility,
  t.assignment_status,
  case when t.visibility = 'family' then t.title else null end as title,
  case when t.visibility = 'family' then t.description else null end as description,
  case when t.visibility = 'family' then t.priority else null end as priority,
  case when t.visibility = 'family' then t.category_id else null end as category_id,
  case when t.visibility = 'family' then t.assignee_member_id else null end as assignee_member_id
from public.tasks t
where
  t.family_id is not null
  and t.family_id in (
    select fm.family_id from public.family_members fm where fm.profile_id = auth.uid()
  );

comment on view public.family_task_board is
  'Family-visible task board, mirroring family_schedule''s sanitization approach for '
  'private family-linked tasks. assignee_member_id is sanitized too, since it would '
  'otherwise leak who a private task is delegated to.';

-- Neither view is meaningful for anon (auth.uid() is null there, so the
-- family_id subquery is always empty) — grants make that explicit rather
-- than relying on the implicit empty result.
revoke all on public.family_schedule from anon, authenticated;
revoke all on public.family_task_board from anon, authenticated;
grant select on public.family_schedule to authenticated;
grant select on public.family_task_board to authenticated;
