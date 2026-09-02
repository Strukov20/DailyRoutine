-- Local-development seed data, run by `supabase db reset` after migrations.
--
-- This file seeds ONLY the system categories (docs/DATA_MODEL.md default
-- set) — these are real application data that would also need to exist in
-- any real deployment, not throwaway test fixtures. It deliberately does
-- NOT create any auth.users / profiles / families — those are created by
-- signing up through the app, or by the deterministic fixtures in
-- supabase/tests/ (which build their own users/families per test file so
-- tests never depend on this seed, per docs/TEST_STRATEGY.md).

insert into public.categories (id, family_id, name, color_token, is_system) values
  ('00000000-0000-0000-0000-000000000001', null, 'Work', 'work', true),
  ('00000000-0000-0000-0000-000000000002', null, 'Family', 'family', true),
  ('00000000-0000-0000-0000-000000000003', null, 'Home', 'home', true),
  ('00000000-0000-0000-0000-000000000004', null, 'Shopping', 'shopping', true),
  ('00000000-0000-0000-0000-000000000005', null, 'Health', 'health', true),
  ('00000000-0000-0000-0000-000000000006', null, 'Other', 'other', true)
on conflict (id) do nothing;
