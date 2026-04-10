-- Tally.app — Invite codes + secure group join RPC
-- Date: 2026-03-27
--
-- Adds `public.groups.invite_code` (if missing) and creates a SECURITY DEFINER
-- function `public.join_group_by_code(p_code text)` that:
-- - validates the caller is authenticated (auth.uid())
-- - verifies invite code exists and resolves its group_id
-- - inserts the caller into group_members (if not already a member)
-- - uses SET search_path = '' for privilege-safety

begin;

-- ----------------------------------------------------------------------------
-- 1) Add invite_code column + unique enforcement
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'groups'
      and column_name = 'invite_code'
  ) then
    alter table public.groups
      add column invite_code text;
  end if;
end $$;

-- UNIQUE: use a unique index (allows multiple NULLs, which is desirable).
create unique index if not exists groups_invite_code_unique_not_null
  on public.groups(invite_code)
  where invite_code is not null;

-- ----------------------------------------------------------------------------
-- 2) Secure join RPC
-- ----------------------------------------------------------------------------

drop function if exists public.join_group_by_code(text);

create or replace function public.join_group_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_code text;
  v_already_member boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  v_code := upper(trim(p_code));
  if v_code is null or v_code = '' then
    raise exception 'Invalid invite code' using errcode = '22023';
  end if;

  -- The app uses 6-hex invite codes (created in create_group_secure()).
  if v_code !~ '^[0-9A-F]{6}$' then
    raise exception 'Invalid invite code format' using errcode = '22023';
  end if;

  select id
  into v_group_id
  from public.groups
  where invite_code = v_code
  limit 1;

  if v_group_id is null then
    raise exception 'Invalid invite code' using errcode = '22023';
  end if;

  -- Avoid duplicates without relying on ON CONFLICT assumptions.
  if exists (
    select 1
    from public.group_members
    where group_id = v_group_id
      and user_id = v_uid
  ) then
    v_already_member := true;
  else
    insert into public.group_members (group_id, user_id, joined_at)
    values (v_group_id, v_uid, now());
  end if;

  return jsonb_build_object(
    'group_id', v_group_id,
    'message', case when v_already_member then 'already_member' else 'joined' end
  );
end;
$$;

-- Lock down execution: allow only authenticated users.
revoke all on function public.join_group_by_code(text) from public;
grant execute on function public.join_group_by_code(text) to authenticated;

commit;

