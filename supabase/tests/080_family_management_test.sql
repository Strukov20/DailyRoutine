-- Tests: create_family_with_owner, the full invitation RPC set (hashed
-- tokens, sanitized preview, accept/decline/revoke), child profile CRUD,
-- remove_family_member (owner-orphan-safe), and regression coverage that
-- families/family_members still have zero direct write grant for
-- `authenticated` — every mutation must go through an RPC.
begin;
select plan(48);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'fm-owner@test.local', 'fm-outsider@test.local', 'fm-invitee@test.local', 'fm-decliner@test.local'
]) as email;

select id as owner_id from auth.users where email = 'fm-owner@test.local' \gset
select id as outsider_id from auth.users where email = 'fm-outsider@test.local' \gset
select id as invitee_id from auth.users where email = 'fm-invitee@test.local' \gset
select id as decliner_id from auth.users where email = 'fm-decliner@test.local' \gset

-- ---------------------------------------------------------------------------
-- Regression: families/family_members still have zero direct write grant
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format(
    $$ insert into public.families (name, owner_id, created_by) values ('Direct insert', %L, %L) $$,
    :'owner_id', :'owner_id'
  ),
  '42501',
  null,
  'authenticated has no direct INSERT grant on families — must go through create_family_with_owner'
);

select throws_ok(
  $$ insert into public.family_members (family_id, member_type, role, display_name, created_by)
     values (gen_random_uuid(), 'child', 'child', 'X', auth.uid()) $$,
  '42501',
  null,
  'authenticated has no direct INSERT grant on family_members — must go through an RPC'
);

-- ---------------------------------------------------------------------------
-- create_family_with_owner
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select * from public.create_family_with_owner('   ') $$,
  '22023',
  null,
  'a blank family name is rejected'
);

select * from public.create_family_with_owner('Test Family') \gset fam_

select is(
  (select owner_id from public.families where id = :'fam_family_id'),
  :'owner_id',
  'the new family''s owner_id is the caller'
);

select is(
  (select count(*)::int from public.family_members where family_id = :'fam_family_id'),
  1,
  'exactly one family_members row exists after creation'
);

select is(
  (select role from public.family_members where id = :'fam_family_member_id'),
  'owner',
  'the created row has role = owner'
);

-- ---------------------------------------------------------------------------
-- create_family_invitation
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select * from public.create_family_invitation(%L, 'not-an-email') $$, :'fam_family_id'),
  '22023',
  null,
  'an invalid email is rejected'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select * from public.create_family_invitation(%L, 'fm-invitee@test.local') $$, :'fam_family_id'),
  '42501',
  null,
  'a non-owner (not even a member) cannot create an invitation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select * from public.create_family_invitation(:'fam_family_id', 'fm-invitee@test.local') \gset inv1_

select ok(:'inv1_token' is not null and length(:'inv1_token') > 32, 'the raw token is returned and non-trivial');

select is(
  (select status from public.family_invitations where invited_email = 'fm-invitee@test.local'),
  'pending',
  'the invitation was created as pending'
);

-- A second invitation to the same email supersedes the first.
select * from public.create_family_invitation(:'fam_family_id', 'fm-invitee@test.local') \gset inv2_

-- token_hash is not selectable even to the owner (column-level grant
-- excludes it — see below), so this status check runs as postgres.
reset role;

select is(
  (select status from public.family_invitations where token_hash = encode(sha256(convert_to(:'inv1_token', 'utf8')), 'hex')),
  'revoked',
  'creating a new invitation to the same email revokes the earlier pending one'
);

select isnt(:'inv1_token'::text, :'inv2_token'::text, 'the two invitations have distinct raw tokens');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------------
-- family_invitations direct SELECT: owner-only, no token_hash column
-- ---------------------------------------------------------------------------
select ok(
  (select count(*)::int from public.family_invitations where family_id = :'fam_family_id') >= 1,
  'the owner can directly SELECT their own family''s invitations'
);

select throws_ok(
  $$ select token_hash from public.family_invitations limit 1 $$,
  '42501',
  null,
  'token_hash is not selectable by anyone, even the owner — column-level grant excludes it'
);

-- ---------------------------------------------------------------------------
-- get_family_invitation_preview
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'invitee_id', 'role', 'authenticated')::text, true);

select is(
  (select is_valid from public.get_family_invitation_preview(:'inv2_token')),
  true,
  'a fresh invitation''s preview is valid'
);

select is(
  (select family_name from public.get_family_invitation_preview(:'inv2_token')),
  'Test Family',
  'the preview exposes the family name'
);

select is(
  (select count(*)::int from public.get_family_invitation_preview('not-a-real-token')),
  0,
  'an unknown token returns zero rows, not an error'
);

select is(
  (select status from public.get_family_invitation_preview(:'inv1_token')),
  'revoked',
  'the superseded invitation''s preview reflects its revoked status'
);

select is(
  (select is_valid from public.get_family_invitation_preview(:'inv1_token')),
  false,
  'a revoked invitation''s preview is not valid'
);

-- The preview must never carry an email or the token/hash — asserted by
-- construction (the function signature has no such output column), and
-- re-asserted here by introspecting the actual column list.
select is(
  (
    select count(*)::int from information_schema.parameters
    where specific_schema = 'public'
      and specific_name = (
        select specific_name from information_schema.routines
        where routine_schema = 'public' and routine_name = 'get_family_invitation_preview'
      )
      and (parameter_name ilike '%email%' or parameter_name ilike '%token%')
      and parameter_mode = 'OUT'
  ),
  0,
  'get_family_invitation_preview has no email/token output column'
);

-- ---------------------------------------------------------------------------
-- accept_family_invitation
-- ---------------------------------------------------------------------------
-- Manually construct an already-expired invitation to test that branch.
-- As postgres: family_invitations has no direct INSERT grant for
-- authenticated, and this fixture bypasses that deliberately.
reset role;

insert into public.family_invitations (family_id, invited_email, invited_by, token_hash, created_at, expires_at, created_by)
values (:'fam_family_id', 'fm-expired@test.local', :'owner_id', encode(sha256('expired-token'::bytea), 'hex'), now() - interval '2 hours', now() - interval '1 hour', :'owner_id');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'invitee_id', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select * from public.accept_family_invitation('expired-token') $$,
  '22023',
  null,
  'an expired invitation cannot be accepted'
);

select * from public.accept_family_invitation(:'inv2_token') \gset acc_

select is(
  :'acc_family_id'::uuid,
  :'fam_family_id'::uuid,
  'accepting returns the correct family_id'
);

reset role;

select is(
  (select role from public.family_members where id = :'acc_family_member_id'),
  'adult',
  'the accepted invitation created an adult (not owner) family_members row'
);

select is(
  (select status from public.family_invitations where token_hash = encode(sha256(convert_to(:'inv2_token', 'utf8')), 'hex')),
  'accepted',
  'the invitation''s status is now accepted'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'invitee_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select * from public.accept_family_invitation(%L) $$, :'inv2_token'),
  '22023',
  null,
  'the same token cannot be accepted twice'
);

-- Owner invites the now-existing member again by mistake; accepting must
-- reject "already a member" rather than creating a duplicate row.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select * from public.create_family_invitation(:'fam_family_id', 'fm-invitee@test.local') \gset inv3_

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'invitee_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select * from public.accept_family_invitation(%L) $$, :'inv3_token'),
  '23505',
  null,
  'a user who is already a member of the family cannot accept a duplicate invitation'
);

-- ---------------------------------------------------------------------------
-- decline_family_invitation
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select * from public.create_family_invitation(:'fam_family_id', 'fm-decliner@test.local') \gset inv4_

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'decliner_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.decline_family_invitation(%L) $$, :'inv4_token'),
  'the invited user can decline'
);

reset role;

select is(
  (select status from public.family_invitations where token_hash = encode(sha256(convert_to(:'inv4_token', 'utf8')), 'hex')),
  'declined',
  'declining sets status to declined'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'decliner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.decline_family_invitation(%L) $$, :'inv4_token'),
  '22023',
  null,
  'a declined invitation cannot be declined again'
);

-- ---------------------------------------------------------------------------
-- revoke_family_invitation
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select * from public.create_family_invitation(:'fam_family_id', 'fm-revoke-target@test.local') \gset inv5_

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.revoke_family_invitation(%L) $$, :'inv5_invitation_id'),
  '42501',
  null,
  'a non-owner cannot revoke an invitation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.revoke_family_invitation(%L) $$, :'inv5_invitation_id'),
  'the owner can revoke a pending invitation'
);

select throws_ok(
  format($$ select public.revoke_family_invitation(%L) $$, :'inv5_invitation_id'),
  '22023',
  null,
  'an already-revoked invitation cannot be revoked again'
);

-- ---------------------------------------------------------------------------
-- create_child_profile / update_child_profile
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ select public.create_child_profile(%L, '') $$, :'fam_family_id'),
  '22023',
  null,
  'a blank child display_name is rejected'
);

select throws_ok(
  format($$ select public.create_child_profile(%L, 'Future Kid', current_date + 1) $$, :'fam_family_id'),
  '22023',
  null,
  'a future date_of_birth is rejected'
);

select public.create_child_profile(:'fam_family_id', 'Kid One', '2020-01-01') as child_id \gset

select is(
  (select member_type from public.family_members where id = :'child_id'),
  'child',
  'the created row is a child'
);

select is(
  (select profile_id from public.family_members where id = :'child_id'),
  null,
  'a child profile has no profile_id — unlinked and undiscoverable via profiles'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.create_child_profile(%L, 'Intruder Kid') $$, :'fam_family_id'),
  '42501',
  null,
  'an outsider cannot add a child profile to a family they are not in'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'invitee_id', 'role', 'authenticated')::text, true);

select lives_ok(
  format($$ select public.update_child_profile(%L, 'Kid One (renamed)') $$, :'child_id'),
  'a regular adult family member (not just the owner) can update a child profile'
);

select is(
  (select display_name from public.family_members where id = :'child_id'),
  'Kid One (renamed)',
  'the child''s display_name was updated'
);

select throws_ok(
  format($$ select public.update_child_profile(%L, 'Nope') $$, :'fam_family_member_id'),
  '22023',
  null,
  'update_child_profile refuses to touch a non-child (the owner''s own row)'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.update_child_profile(%L, 'Nope') $$, :'child_id'),
  '42501',
  null,
  'an outsider cannot update a child profile'
);

-- ---------------------------------------------------------------------------
-- remove_family_member: owner-only, owner-orphan-safe
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'invitee_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.remove_family_member(%L) $$, :'child_id'),
  '42501',
  null,
  'a non-owner adult cannot remove a family member'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.remove_family_member(%L) $$, :'fam_family_member_id'),
  '22023',
  null,
  'the owner row itself can never be removed'
);

select lives_ok(
  format($$ select public.remove_family_member(%L) $$, :'child_id'),
  'the owner can remove a child member'
);

-- Phase 5: remove_family_member soft-deletes (removed_at) rather than hard
-- deleting — a hard delete is unsafe once task_assignments audit history
-- can reference a family_members row (see docs/DECISIONS.md, "Phase 5").
-- The row survives; is_family_member()/the roster policy still surface it
-- (it's a direct table SELECT, not membership-gated per row), but the
-- removed profile itself loses all access via is_family_member/is_family_owner.
select is(
  (select removed_at is not null from public.family_members where id = :'child_id'),
  true,
  'the removed child row is soft-deleted (removed_at set), not hard-deleted'
);

select throws_ok(
  format($$ select public.remove_family_member(%L) $$, :'child_id'),
  '22023',
  null,
  'removing an already-removed (nonexistent) member id fails clearly'
);

-- ---------------------------------------------------------------------------
-- anonymous: no execute grant on any of these RPCs
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select * from public.create_family_with_owner('Anon Family') $$,
  '42501',
  null,
  'anonymous cannot call create_family_with_owner'
);

select throws_ok(
  format($$ select * from public.get_family_invitation_preview(%L) $$, :'inv2_token'),
  '42501',
  null,
  'anonymous cannot call get_family_invitation_preview either — the whole app requires sign-in first'
);

select * from finish();
rollback;
