-- Tally.app — Update users.is_premium via secure RPC
-- Date: 2026-03-28
--
-- This RPC is required because the app client must not be able to update
-- `public.users.is_premium` directly (trigger blocks it).
-- We use SECURITY DEFINER to perform the update safely.

begin;

create schema if not exists private;

-- ----------------------------------------------------------------------------
-- 1) Privileged implementation
-- ----------------------------------------------------------------------------
create or replace function private.update_premium_status(p_is_premium boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update public.users
  set is_premium = p_is_premium
  where id = auth.uid();
end;
$$;

revoke all on function private.update_premium_status(boolean) from public;
grant execute on function private.update_premium_status(boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Public wrapper for the app
-- ----------------------------------------------------------------------------
drop function if exists public.update_premium_status(boolean);

create or replace function public.update_premium_status(p_is_premium boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.update_premium_status(p_is_premium);
$$;

revoke all on function public.update_premium_status(boolean) from public;
grant execute on function public.update_premium_status(boolean) to authenticated;

commit;

