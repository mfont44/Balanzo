-- Tally.app — Reliable stale-participant detection for a group (bypasses client query edge cases).
-- True when a non-settled expense has paid_by not in group_members, or a split user_id not in group_members.
-- paid_by IS NULL is excluded (handled by orphan liquidate flow).

begin;

create or replace function public.group_has_stale_participants(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.expenses e
    where e.group_id = p_group_id
      and coalesce(e.is_settlement, false) = false
      and coalesce(e.is_settled, false) = false
      and (
        (
          e.paid_by is not null
          and not exists (
            select 1
            from public.group_members gm
            where gm.group_id = p_group_id
              and gm.user_id = e.paid_by
          )
        )
        or exists (
          select 1
          from public.expense_splits es
          where es.expense_id = e.id
            and not exists (
              select 1
              from public.group_members gm
              where gm.group_id = p_group_id
                and gm.user_id = es.user_id
            )
        )
      )
  )
  and exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = (select auth.uid())
  );
$$;

revoke all on function public.group_has_stale_participants(uuid) from public;
grant execute on function public.group_has_stale_participants(uuid) to authenticated;

commit;
