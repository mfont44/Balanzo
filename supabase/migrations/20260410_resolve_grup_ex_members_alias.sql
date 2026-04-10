-- Tally.app — Alias RPC name (typo-tolerant) for PostgREST / schema cache mismatches.
-- Forwards to public.resolve_group_ex_members (defined in 20260406_resolve_group_ex_members.sql).

begin;

create or replace function public.resolve_grup_ex_members(p_group_id uuid, p_mode text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.resolve_group_ex_members(p_group_id, p_mode);
$$;

revoke all on function public.resolve_grup_ex_members(uuid, text) from public;
grant execute on function public.resolve_grup_ex_members(uuid, text) to authenticated;

commit;
