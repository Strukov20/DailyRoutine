-- Phase 10 — delete_family() didn't broadcast at all: unlike every mutation
-- on family_members (covered automatically by broadcast_family_member_
-- change_trigger), a family being deleted only ever touches the families
-- row itself, which has no broadcast trigger of its own. Other connected
-- devices belonging to the deleted family would only find out on their
-- next unrelated refetch. transfer_family_ownership needs no equivalent
-- fix — it always updates two family_members rows, which the existing
-- trigger already covers.
create or replace function public.delete_family(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_profile_id uuid;
begin
  if not public.is_family_owner(p_family_id) then
    raise exception 'only the family owner can delete the family' using errcode = '42501';
  end if;

  update public.family_invitations
  set status = 'revoked', responded_at = now()
  where family_id = p_family_id and status = 'pending';

  update public.families set deleted_at = now() where id = p_family_id;

  perform public.emit_invalidation('family:' || p_family_id, 'members');
  for v_member_profile_id in
    select profile_id from public.family_members
    where family_id = p_family_id and removed_at is null and profile_id is not null
  loop
    perform public.emit_invalidation('profile:' || v_member_profile_id, 'members');
  end loop;
end;
$$;

comment on function public.delete_family(uuid) is
  'Owner-only, soft delete (families.deleted_at) — is_family_member/is_family_owner/'
  'current_family_ids all exclude a deleted family immediately, so every member (including '
  'the former owner) loses access in the same instant, everywhere, via that one choke '
  'point. Tasks/events/responsibilities/assignment-audit rows/notification outbox rows are '
  'never deleted — they remain as historical data, simply unreachable once membership can '
  'no longer be established. Every pending invitation is revoked in the same transaction. '
  'Broadcasts a ''members'' invalidation to the family topic and every current member''s own '
  'profile topic — families has no broadcast trigger of its own, unlike family_members. See '
  'docs/DECISIONS.md, "Phase 10," for the full per-table lifecycle writeup.';
