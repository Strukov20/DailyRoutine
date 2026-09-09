-- Tests: Phase 10 security audit finding — create_personal_task/
-- update_personal_task must never accept a category_id belonging to a
-- different family than the task's own (a system category, family_id
-- null, is always fine; a family category must match).
begin;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array['tcg-owner@test.local', 'tcg-outsider@test.local']) as email;

select id as owner_id from auth.users where email = 'tcg-owner@test.local' \gset
select id as outsider_id from auth.users where email = 'tcg-outsider@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Category Guard Family', :'owner_id', :'owner_id')
returning id as family_id \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Other Family', :'outsider_id', :'outsider_id')
returning id as other_family_id \gset

insert into public.family_members (id, family_id, member_type, role, profile_id, display_name, created_by)
values (gen_random_uuid(), :'family_id', 'adult', 'owner', :'owner_id', 'Owner', :'owner_id')
returning id as owner_member_id \gset

insert into public.categories (id, family_id, name, color_token, is_system)
values (gen_random_uuid(), null, 'System Default', 'blue', true)
returning id as system_category_id \gset

insert into public.categories (id, family_id, name, color_token, is_system, created_by)
values (gen_random_uuid(), :'family_id', 'Own Family Category', 'green', false, :'owner_id')
returning id as own_category_id \gset

insert into public.categories (id, family_id, name, color_token, is_system, created_by)
values (gen_random_uuid(), :'other_family_id', 'Other Family Category', 'red', false, :'outsider_id')
returning id as other_category_id \gset

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_id', 'role', 'authenticated')::text, true);

select throws_ok(
  format($$ select public.create_personal_task('Bad category', p_category_id := %L) $$, :'other_category_id'),
  '22023',
  null,
  'create_personal_task rejects a category_id belonging to another family (personal task, no family_id)'
);
select throws_ok(
  format(
    $$ select public.create_personal_task('Bad category', p_category_id := %L, p_visibility := 'family', p_family_id := %L) $$,
    :'other_category_id', :'family_id'
  ),
  '22023',
  null,
  'create_personal_task rejects a category_id belonging to another family, even for a family-visibility task'
);
select lives_ok(
  format($$ select public.create_personal_task('System category ok', p_category_id := %L) $$, :'system_category_id'),
  'create_personal_task accepts a system category for a personal task'
);
select lives_ok(
  format(
    $$ select public.create_personal_task('Own category ok', p_category_id := %L, p_visibility := 'family', p_family_id := %L) $$,
    :'own_category_id', :'family_id'
  ),
  'create_personal_task accepts the task''s own family''s category'
);

select public.create_personal_task(
  'Task to edit', p_visibility := 'family', p_family_id := :'family_id'
) as edit_task_id \gset

select throws_ok(
  format($$ select public.update_personal_task(%L, p_category_id := %L) $$, :'edit_task_id', :'other_category_id'),
  '22023',
  null,
  'update_personal_task rejects a category_id belonging to another family'
);
select lives_ok(
  format($$ select public.update_personal_task(%L, p_category_id := %L) $$, :'edit_task_id', :'own_category_id'),
  'update_personal_task accepts the task''s own family''s category'
);
select is(
  (select category_id from public.tasks where id = :'edit_task_id'),
  :'own_category_id'::uuid,
  'the category actually changed'
);
select lives_ok(
  format($$ select public.update_personal_task(%L, p_title := 'Renamed only') $$, :'edit_task_id'),
  'update_personal_task with no category change never re-validates the existing (unchanged) category'
);

select * from finish();
rollback;
