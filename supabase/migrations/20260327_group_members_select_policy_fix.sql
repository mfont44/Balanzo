-- Tally.app — Fix infinite recursion in RLS policy for group_members (SELECT)
-- Date: 2026-03-27
--
-- Root cause:
-- - The current SELECT policy for public.group_members uses a subquery that selects
--   from public.group_members again inside the USING expression.
-- - This can trigger "infinite recursion detected in policy for relation
--   group_members" during policy evaluation.
--
-- Remediation:
-- - Create a SECURITY DEFINER helper in schema private to check membership.
-- - Replace the group_members SELECT policy to call that helper instead of
--   querying group_members from inside the USING clause.

begin;

create schema if not exists private;

create or replace function private.is_user_member_of_group(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_group_id is null then
    return false;
  end if;

  -- SECURITY DEFINER: bypasses RLS while checking membership.
  return exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = v_uid
  );
end;
$$;

revoke all on function private.is_user_member_of_group(uuid) from public;
grant execute on function private.is_user_member_of_group(uuid) to authenticated;

drop policy if exists "group_members_select_member_v2" on public.group_members;

create policy "group_members_select_member_v2"
on public.group_members
for select
to authenticated
using (
  private.is_user_member_of_group(group_members.group_id)
);

commit;

