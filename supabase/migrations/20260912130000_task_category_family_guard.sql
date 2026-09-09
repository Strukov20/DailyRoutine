-- Phase 10 security audit finding (Medium — defense in depth, not a
-- reachable leak through the shipped UI, which only ever offers the
-- caller's own family's categories plus system ones): tasks.category_id
-- has no guard tying its family to the task's own family_id. create_
-- personal_task/update_personal_task run as SECURITY DEFINER, bypassing
-- categories' own RLS, so nothing previously stopped a direct RPC call
-- from attaching a task to another family's custom category. A composite
-- FK can't express this rule (a category is valid either when it's a
-- system default, family_id null, *or* when it belongs to the task's own
-- family — an OR a plain FK cannot encode), so the check is added inside
-- both RPCs instead.

create or replace function public.create_personal_task(
  p_title text,
  p_description text default null,
  p_date date default null,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_timezone text default null,
  p_priority text default 'normal',
  p_category_id uuid default null,
  p_visibility text default 'private',
  p_family_id uuid default null,
  p_client_operation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_task_id uuid;
begin
  if v_profile_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_client_operation_id is not null then
    select id into v_task_id
    from public.tasks
    where owner_profile_id = v_profile_id and client_operation_id = p_client_operation_id;

    if v_task_id is not null then
      return v_task_id;
    end if;
  end if;

  if p_family_id is not null and not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = p_category_id and (c.is_system or c.family_id = p_family_id)
  ) then
    raise exception 'category not available for this task' using errcode = '22023';
  end if;

  insert into public.tasks (
    owner_profile_id, family_id, title, description, date, start_time, duration_minutes,
    timezone, priority, category_id, visibility, created_by, client_operation_id
  ) values (
    v_profile_id, p_family_id, p_title, p_description, p_date, p_start_time, p_duration_minutes,
    p_timezone, coalesce(p_priority, 'normal'), p_category_id, coalesce(p_visibility, 'private'),
    v_profile_id, p_client_operation_id
  )
  returning id into v_task_id;

  return v_task_id;
end;
$$;

comment on function public.create_personal_task(text, text, date, time, integer, text, text, uuid, text, uuid, uuid) is
  'The only way to create a task. owner_profile_id is always the caller — never a parameter. '
  'p_client_operation_id: replaying the same id for the same caller returns the original '
  'task id rather than creating a duplicate (Phase 9 offline-queue idempotency). Phase 10: '
  'p_category_id must be a system category or belong to p_family_id — never another '
  'family''s custom category.';

create or replace function public.update_personal_task(
  p_task_id uuid,
  p_title text default null,
  p_description text default null,
  p_clear_description boolean default false,
  p_priority text default null,
  p_category_id uuid default null,
  p_clear_category boolean default false,
  p_visibility text default null,
  p_family_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_family_id uuid;
  v_assignment_status text;
  v_updated_at timestamptz;
  v_current_category_id uuid;
  v_new_family_id uuid;
  v_new_category_id uuid;
begin
  select owner_profile_id, family_id, assignment_status, updated_at, category_id
    into v_owner, v_family_id, v_assignment_status, v_updated_at, v_current_category_id
  from public.tasks
  where id = p_task_id and deleted_at is null;

  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'task unavailable' using errcode = '42501';
  end if;

  if p_expected_updated_at is not null and p_expected_updated_at <> v_updated_at then
    raise exception 'task changed on another device since the offline snapshot was taken'
      using errcode = '40001', hint = 'stale_write';
  end if;

  if p_family_id is not null and not public.is_family_member(p_family_id) then
    raise exception 'not a member of that family' using errcode = '42501';
  end if;

  if v_assignment_status <> 'unassigned' then
    if p_visibility = 'private' then
      raise exception
        'a task with an active assignment cannot become Private — unassign it first'
        using errcode = '22023';
    end if;
    if p_family_id is not null and p_family_id <> v_family_id then
      raise exception
        'a task with an active assignment cannot be moved to another family — unassign it first'
        using errcode = '22023';
    end if;
  end if;

  v_new_family_id := coalesce(p_family_id, v_family_id);
  v_new_category_id := case when p_clear_category then null else coalesce(p_category_id, v_current_category_id) end;

  if v_new_category_id is not null and v_new_category_id is distinct from v_current_category_id and not exists (
    select 1 from public.categories c
    where c.id = v_new_category_id and (c.is_system or c.family_id = v_new_family_id)
  ) then
    raise exception 'category not available for this task' using errcode = '22023';
  end if;

  update public.tasks set
    title = coalesce(p_title, title),
    description = case when p_clear_description then null else coalesce(p_description, description) end,
    priority = coalesce(p_priority, priority),
    category_id = v_new_category_id,
    visibility = coalesce(p_visibility, visibility),
    family_id = v_new_family_id
  where id = p_task_id;
end;
$$;

comment on function public.update_personal_task(uuid, text, text, boolean, text, uuid, boolean, text, uuid, timestamptz) is
  'Final Phase 9 pass: "not found" and "not yours" are deliberately indistinguishable (both '
  '42501, same message). Phase 10: p_category_id (or the task''s existing category, if left '
  'unchanged and the task is being moved to a different family) must be a system category or '
  'belong to the task''s resulting family — checked only when the category is actually '
  'changing, never re-validated on every unrelated edit.';
