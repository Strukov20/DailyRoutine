-- Tests: Phase 10 (MVP Stabilization) mandatory release-safety functionality
-- — transfer_family_ownership, delete_family, leave_family, and
-- request_account_deletion. None of these RPCs existed before this phase
-- (confirmed by audit — see docs/DECISIONS.md, "Phase 10").
begin;
select plan(40);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array[
  'rs-owner@test.local', 'rs-adult-b@test.local', 'rs-adult-c@test.local', 'rs-outsider@test.local'
]) as email;

select id as owner_id from auth.users where email = 'rs-owner@test.local' \gset
select id as adult_b_id from auth.users where email = 'rs-adult-b@test.local' \gset
select id as adult_c_id from auth.users where email = 'rs-adult-c@test.local' \gset
select id as outsider_id from auth.users where email = 'rs-outsider@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Release Safety Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Other Family', :'outsider_id', :'outsider_id')
returning id as other_family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id')
returning id as owner_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'adult_b_id', 'Adult B', :'owner_id')
returning id as adult_b_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'adult', :'adult_c_id', 'Adult C', :'owner_id')
returning id as adult_c_member_id \gset

insert into public.family_members (id, family_id, member_type, role, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'child', 'child', 'Kid', :'owner_id')
returning id as child_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'other_family_id', 'adult', 'owner', :'outsider_id', 'Outsider Owner', :'outsider_id')
returning id as other_owner_member_id \gset

-- ---------------------------------------------------------------------------
-- transfer_family_ownership
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.transfer_family_ownership(%L, %L) $$, :'family_id', :'adult_c_member_id'),
  '42501',
  null,
  'only the family owner can transfer ownership'
);

select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.transfer_family_ownership(%L, %L) $$, :'family_id', :'child_member_id'),
  '22023',
  null,
  'ownership cannot be transferred to a child profile'
);

select throws_ok(
  format($$ select public.transfer_family_ownership(%L, %L) $$, :'family_id', :'owner_member_id'),
  '22023',
  null,
  'transferring ownership to the caller''s own member row is rejected'
);

-- Same "unavailable" outcome for a random id, another family's member, and
-- (later) a removed member — never a distinguishable error, matching the
-- Phase 9 "no existence oracle" convention (docs/DECISIONS.md, "Phase 9").
select throws_ok(
  format($$ select public.transfer_family_ownership(%L, %L) $$, :'family_id', gen_random_uuid()),
  '42501',
  null,
  'transfer_family_ownership: a random member id is "unavailable" (42501), not a distinct not-found code'
);
select throws_ok(
  format($$ select public.transfer_family_ownership(%L, %L) $$, :'family_id', :'other_owner_member_id'),
  '42501',
  null,
  'transfer_family_ownership: another family''s member id is "unavailable" (42501), same as a random id'
);

select public.transfer_family_ownership(:'family_id', :'adult_b_member_id');

select is(
  (select owner_id from public.families where id = :'family_id'),
  :'adult_b_id'::uuid,
  'families.owner_id now points at the new owner'
);
select is(
  (select role from public.family_members where id = :'owner_member_id'),
  'adult',
  'the previous owner becomes a plain adult member — never removed'
);
select is(
  (select role from public.family_members where id = :'adult_b_member_id'),
  'owner',
  'the target member is now the owner'
);
select is(
  (select count(*)::int from public.family_members where family_id = :'family_id' and role = 'owner'),
  1,
  'exactly one owner row exists after the transfer — never zero, never two'
);
select is(
  (select count(*)::int from public.family_ownership_transfers where family_id = :'family_id'),
  1,
  'an append-only audit row was recorded for the transfer'
);
select is(
  (select previous_owner_member_id from public.family_ownership_transfers where family_id = :'family_id'),
  :'owner_member_id'::uuid,
  'the audit row names the correct previous owner'
);
select is(
  (select new_owner_member_id from public.family_ownership_transfers where family_id = :'family_id'),
  :'adult_b_member_id'::uuid,
  'the audit row names the correct new owner'
);

-- The former owner (now a plain adult) can be removed by the new owner —
-- proving the role change is real, not merely cosmetic.
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);
select lives_ok(
  format($$ select public.remove_family_member(%L) $$, :'owner_member_id'),
  'the new owner can remove the former owner, now that they are a plain adult member'
);
select is(
  (select removed_at is not null from public.family_members where id = :'owner_member_id'),
  true,
  'the former owner''s membership row is soft-removed'
);

-- anon spot-check (redundant with the schema-wide 130 guard, explicit here).
select throws_ok(
  format($$ set local role anon; select public.transfer_family_ownership(%L, %L) $$, :'family_id', :'adult_c_member_id'),
  '42501',
  null,
  'anon cannot call transfer_family_ownership at all'
);

-- ---------------------------------------------------------------------------
-- leave_family — owner blocked, non-owner adult can self-leave
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.leave_family(%L) $$, :'family_id'),
  '22023',
  null,
  'the current owner cannot leave_family directly — must transfer or delete first'
);

select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);
select lives_ok(
  format($$ select public.leave_family(%L) $$, :'family_id'),
  'a non-owner adult member can leave their own family'
);

-- Checked as postgres, not as adult_c: having just left, adult_c's own
-- is_family_member(family_id) is now false, so family_members_select_same_
-- family (RLS) correctly hides every row in this family from them,
-- including their own now-removed one — that's the feature working, not a
-- gap, but it means this check needs a privileged role to observe.
reset role;
select is(
  (select removed_at is not null from public.family_members where id = :'adult_c_member_id'),
  true,
  'the leaving member''s row is soft-removed'
);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.leave_family(%L) $$, :'family_id'),
  '42501',
  null,
  'leave_family is idempotent-safe against a double-tap — the second call finds no current membership and refuses cleanly'
);

select throws_ok(
  format($$ set local role anon; select public.leave_family(%L) $$, :'family_id'),
  '42501',
  null,
  'anon cannot call leave_family at all'
);

-- ---------------------------------------------------------------------------
-- delete_family — owner-only, and every member (including the owner) loses
-- access in the same instant via the is_family_member/is_family_owner/
-- current_family_ids choke point.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.delete_family(%L) $$, :'other_family_id'),
  '42501',
  null,
  'only the owner of that specific family can delete it — not the owner of a different family'
);

select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);
select * from public.create_family_invitation(:'family_id', 'still-pending@test.local') \gset

select public.delete_family(:'family_id');

-- Checked as postgres: adult_b (the former owner) can no longer see this
-- family via RLS at all once it's deleted — including the family row and
-- its invitations — same reasoning as the leave_family check above.
reset role;
select is(
  (select deleted_at is not null from public.families where id = :'family_id'),
  true,
  'families.deleted_at is set'
);
select is(
  (select status from public.family_invitations where id = :'invitation_id'),
  'revoked',
  'every pending invitation is revoked in the same transaction as the delete'
);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_b_id', 'role', 'authenticated')::text, true);

select is(
  public.is_family_member(:'family_id', :'adult_b_id'),
  false,
  'is_family_member excludes a deleted family, even for its own (former) owner'
);
select is(
  public.is_family_owner(:'family_id', :'adult_b_id'),
  false,
  'is_family_owner excludes a deleted family'
);
select is(
  (select :'family_id'::uuid = any(array(select public.current_family_ids()))),
  false,
  'current_family_ids no longer lists a deleted family'
);
select is(
  (select count(*)::int from public.families where id = :'family_id'),
  0,
  'the deleted family no longer appears via a direct SELECT (families_select_member routes through is_family_member)'
);

select throws_ok(
  format($$ set local role anon; select public.delete_family(%L) $$, :'other_family_id'),
  '42501',
  null,
  'anon cannot call delete_family at all'
);

-- ---------------------------------------------------------------------------
-- request_account_deletion
-- ---------------------------------------------------------------------------
reset role;
insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Deletable Owner Family', :'adult_c_id', :'adult_c_id')
returning id as owner_family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'owner_family_id', 'adult', 'owner', :'adult_c_id', 'Adult C', :'adult_c_id')
returning id as owner_family_member_id \gset

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.request_account_deletion() $$,
  '22023',
  null,
  'an account that currently owns a family cannot be deleted until that family is transferred or deleted'
);

-- Resolve it by deleting that family, then retry.
select public.delete_family(:'owner_family_id');

-- Fixtures for the actual deletion proof: a second family adult_c belongs
-- to (non-owner, so deletion should leave it), a private task/event, and a
-- family-shared task/event that must survive (another member may depend on
-- it).
reset role;
insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Second Family', :'outsider_id', :'outsider_id')
returning id as second_family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'second_family_id', 'adult', 'owner', :'outsider_id', 'Outsider', :'outsider_id')
returning id as second_family_owner_member_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'second_family_id', 'adult', 'adult', :'adult_c_id', 'Adult C', :'outsider_id')
returning id as second_family_member_id \gset

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select public.create_personal_task('Private task to delete', p_visibility := 'private') as private_task_id \gset
select public.create_personal_task(
  'Shared task that must survive', p_visibility := 'family', p_family_id := :'second_family_id'
) as shared_task_id \gset

select public.register_notification_token('ExponentPushToken[release-safety-test]', 'ios');

select public.request_account_deletion();

-- Checked as postgres: request_account_deletion just removed adult_c from
-- second_family_id, so their own is_family_member(second_family_id) is now
-- false — same RLS-visibility reasoning as the leave_family/delete_family
-- checks above (this time for family_members specifically; the profiles
-- and tasks reads below happen to remain visible to adult_c's own session
-- via owner-scoped policies, but checking everything under one privileged
-- role here is simpler than reasoning about each policy individually).
reset role;
select is(
  (select display_name from public.profiles where id = :'adult_c_id'),
  'Deleted user',
  'the profile display name is anonymized'
);
select is(
  (select deleted_at is not null from public.profiles where id = :'adult_c_id'),
  true,
  'profiles.deleted_at is set — never a hard delete of the row'
);
select is(
  (select removed_at is not null from public.family_members where id = :'second_family_member_id'),
  true,
  'the account''s non-owner membership in the second family is soft-removed'
);
select is(
  (select deleted_at is not null from public.tasks where id = :'private_task_id'),
  true,
  'the account''s own private task is soft-deleted'
);
select is(
  (select deleted_at from public.tasks where id = :'shared_task_id'),
  null,
  'a family-shared task the account owns is left in place — never orphaned for other members'
);
select is(
  (select count(*)::int from public.notification_tokens where profile_id = :'adult_c_id' and deactivated_at is not null),
  1,
  'every device token for the deleted account is deactivated'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ select public.request_account_deletion() $$,
  'a repeat call after the profile is already anonymized is a safe, idempotent no-op — never errors, never double-processes'
);

reset role;
select is(
  (select count(*)::int from public.notification_tokens where profile_id = :'adult_c_id' and deactivated_at is not null),
  1,
  'a repeat call does not create a second deactivation or otherwise duplicate state'
);

select throws_ok(
  $$ set local role anon; select public.request_account_deletion() $$,
  '42501',
  null,
  'anon cannot call request_account_deletion at all'
);

-- ---------------------------------------------------------------------------
-- Internal helper is unreachable from any client role.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'adult_c_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public._remove_or_leave_family_member(%L, %L) $$, :'adult_c_member_id', :'adult_c_member_id'),
  '42501',
  null,
  'authenticated cannot call the internal _remove_or_leave_family_member helper directly'
);
select throws_ok(
  format($$ set local role anon; select public._remove_or_leave_family_member(%L, %L) $$, :'adult_c_member_id', :'adult_c_member_id'),
  '42501',
  null,
  'anon cannot call the internal helper either'
);

select * from finish();
rollback;
