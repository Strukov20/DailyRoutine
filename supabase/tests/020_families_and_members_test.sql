-- Tests: family_members RLS + integrity constraints. Personas: owner A and
-- adult B in Family Alpha, a child in Family Alpha, outsider C (no family),
-- adult D who owns a different family (Family Beta). See
-- docs/DATA_MODEL.md and docs/DECISIONS.md ("Owner consistency").
begin;
select plan(13);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres — bypasses RLS)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'fam-owner-a@test.local', 'fam-adult-b@test.local', 'fam-outsider-c@test.local', 'fam-owner-d@test.local'
]) as email;

select id as owner_a_id from auth.users where email = 'fam-owner-a@test.local' \gset
select id as adult_b_id from auth.users where email = 'fam-adult-b@test.local' \gset
select id as outsider_c_id from auth.users where email = 'fam-outsider-c@test.local' \gset
select id as owner_d_id from auth.users where email = 'fam-owner-d@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Family Alpha', :'owner_a_id', :'owner_a_id')
returning id as family_alpha_id \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Family Beta', :'owner_d_id', :'owner_d_id')
returning id as family_beta_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_alpha_id', 'adult', 'owner', :'owner_a_id', 'Owner A', :'owner_a_id')
returning id as owner_a_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_alpha_id', 'adult', 'adult', :'adult_b_id', 'Adult B', :'owner_a_id')
returning id as adult_b_member_id \gset

insert into public.family_members (id, family_id, member_type, role, display_name, date_of_birth, created_by)
values (gen_random_uuid(), :'family_alpha_id', 'child', 'child', 'Kid Alpha', '2018-01-01', :'owner_a_id')
returning id as child_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_beta_id', 'adult', 'owner', :'owner_d_id', 'Owner D', :'owner_d_id')
returning id as owner_d_member_id \gset

-- ---------------------------------------------------------------------------
-- Integrity: at most one owner per family
-- ---------------------------------------------------------------------------
-- Uses owner_a_id (not adult_b_id) so this specifically isolates the
-- partial unique index — a row whose profile_id *doesn't* match
-- families.owner_id would instead be caught by
-- assert_family_owner_consistency first (a different, also-correct
-- rejection, but not the one this test is targeting).
select throws_ok(
  format(
    $$ insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
       values (%L, 'adult', 'owner', %L, 'Second Owner Row', %L) $$,
    :'family_alpha_id', :'owner_a_id', :'owner_a_id'
  ),
  '23505',
  null,
  'a second role=owner row in the same family violates the one-owner-per-family unique index'
);

-- ---------------------------------------------------------------------------
-- Integrity: owner consistency trigger rejects an owner row that doesn't
-- match families.owner_id
-- ---------------------------------------------------------------------------
insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Family Gamma', :'owner_a_id', :'owner_a_id')
returning id as family_gamma_id \gset

select throws_ok(
  format(
    $$ insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
       values (%L, 'adult', 'owner', %L, 'Wrong Owner', %L) $$,
    :'family_gamma_id', :'adult_b_id', :'owner_a_id'
  ),
  '23514',
  null,
  'an owner row whose profile_id disagrees with families.owner_id is rejected'
);

-- ---------------------------------------------------------------------------
-- Integrity: an adult/owner row must have a linked profile_id
-- ---------------------------------------------------------------------------
select throws_ok(
  format(
    $$ insert into public.family_members (family_id, member_type, role, display_name, created_by)
       values (%L, 'adult', 'adult', 'No Account Adult', %L) $$,
    :'family_alpha_id', :'owner_a_id'
  ),
  '23514',
  null,
  'an adult-type member without profile_id violates family_members_role_matches_type'
);

-- ---------------------------------------------------------------------------
-- RLS: family_members roster visibility
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_a_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.family_members where family_id = :'family_alpha_id'),
  3,
  'owner A sees all 3 members of Family Alpha (owner, adult, child)'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.family_members where family_id = :'family_alpha_id'),
  3,
  'adult B (non-owner member) also sees the full roster of their own family'
);

select is(
  (select count(*)::int from public.families where id = :'family_alpha_id'),
  1,
  'adult B can see the family row itself'
);

-- ---------------------------------------------------------------------------
-- RLS: outsider cannot discover the family or its members/children
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_c_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.families where id = :'family_alpha_id'),
  0,
  'outsider C cannot discover Family Alpha'
);

select is(
  (select count(*)::int from public.family_members where family_id = :'family_alpha_id'),
  0,
  'outsider C cannot list Family Alpha''s members'
);

select is(
  (select count(*)::int from public.family_members where id = :'child_member_id'),
  0,
  'outsider C cannot see the child''s member row'
);

-- ---------------------------------------------------------------------------
-- RLS: a different family's owner (D) cannot see Family Alpha either
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_d_id', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.family_members where family_id = :'family_alpha_id'),
  0,
  'owner D (a different family''s owner) cannot see Family Alpha''s members'
);

-- Row-level policies for family_members writes exist (owner_manages_roster)
-- but no INSERT/UPDATE grant is issued yet this phase — membership changes
-- are Phase 3 work behind reviewed RPCs. Prove the grant-level lockout here
-- so a future migration can't loosen it without this test noticing.
select throws_ok(
  format(
    $$ insert into public.family_members (family_id, member_type, role, display_name, created_by)
       values (%L, 'child', 'child', 'Should Fail', %L) $$,
    :'family_beta_id', :'owner_d_id'
  ),
  '42501',
  null,
  'even the family owner cannot INSERT into family_members yet — no grant issued this phase'
);

-- ---------------------------------------------------------------------------
-- RLS: anonymous
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select count(*) from public.families $$,
  '42501',
  null,
  'anonymous has no grant on families at all'
);

select throws_ok(
  $$ select count(*) from public.family_members $$,
  '42501',
  null,
  'anonymous has no grant on family_members at all'
);

select * from finish();
rollback;
