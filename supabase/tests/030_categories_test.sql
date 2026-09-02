-- Tests: categories RLS (system visible to all authenticated users, custom
-- family categories visible only to that family, outsider blocked).
begin;
select plan(5);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token
)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       email, 'not-a-real-hash', now(), now(), now(), '{}', '{}', false, ''
from unnest(array['cat-owner-a@test.local', 'cat-outsider-c@test.local']) as email;

select id as owner_a_id from auth.users where email = 'cat-owner-a@test.local' \gset
select id as outsider_c_id from auth.users where email = 'cat-outsider-c@test.local' \gset

insert into public.families (id, name, owner_id, created_by)
values (gen_random_uuid(), 'Category Test Family', :'owner_a_id', :'owner_a_id')
returning id as family_id \gset

insert into public.family_members (family_id, member_type, role, profile_id, display_name, created_by)
values (:'family_id', 'adult', 'owner', :'owner_a_id', 'Owner A', :'owner_a_id');

insert into public.categories (id, family_id, name, color_token, is_system, created_by)
values (gen_random_uuid(), :'family_id', 'Custom Hobby', 'other', false, :'owner_a_id')
returning id as custom_category_id \gset

-- System categories exist from supabase/seed.sql; if seed.sql hasn't run in
-- this harness, insert one directly so the test is self-contained either way.
insert into public.categories (id, family_id, name, color_token, is_system)
values ('00000000-0000-0000-0000-000000000099', null, 'Test System Category', 'other', true)
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_a_id', 'role', 'authenticated')::text, true);

select ok(
  (select count(*)::int from public.categories where is_system) > 0,
  'family member can see system categories'
);

select is(
  (select count(*)::int from public.categories where id = :'custom_category_id'),
  1,
  'family member can see their own family''s custom category'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'outsider_c_id', 'role', 'authenticated')::text, true);

select ok(
  (select count(*)::int from public.categories where is_system) > 0,
  'outsider can still see system categories (they are public defaults)'
);

select is(
  (select count(*)::int from public.categories where id = :'custom_category_id'),
  0,
  'outsider cannot see another family''s custom category'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.categories),
  0,
  'anonymous sees zero categories (system categories require authentication too)'
);

select * from finish();
rollback;
