-- Tally.app — Resolve expenses when former members left the group (creator-only RPC).
-- Modes:
--   redistribute: assign paid_by to creator if absent; strip itemized rows; delete splits for
--     non-members; redistribute absent amounts equally among current members; reconcile cents.
--   forgive: strip itemized rows; delete non-member splits; shrink expense.amount to sum of
--     remaining splits; assign paid_by to creator if absent; delete expense if amount becomes 0.

begin;

create or replace function public.resolve_group_ex_members(
  p_group_id uuid,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_member_ids uuid[];
  v_n int;
  r_exp record;
  v_absent_sum numeric(14, 2);
  v_absent_cents bigint;
  v_per_cents bigint;
  v_rem int;
  v_idx int;
  v_add numeric(14, 2);
  v_m uuid;
  v_new_amt numeric(14, 2);
  v_sum_splits numeric(14,  2);
  v_updated int := 0;
  v_needs boolean;
  v_mid uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_mode is null or p_mode not in ('redistribute', 'forgive') then
    raise exception 'Invalid mode';
  end if;

  if not exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.created_by = v_uid
  ) then
    raise exception 'Only the group creator can resolve former member expenses';
  end if;

  select coalesce(
    g.created_by,
    (
      select gm.user_id
      from public.group_members gm
      where gm.group_id = g.id
      order by gm.joined_at asc nulls last
      limit 1
    )
  )
  into v_owner
  from public.groups g
  where g.id = p_group_id;

  if v_owner is null then
    raise exception 'Group has no assignable owner';
  end if;

  select coalesce(array_agg(gm.user_id order by gm.user_id), array[]::uuid[])
  into v_member_ids
  from public.group_members gm
  where gm.group_id = p_group_id;

  v_n := coalesce(array_length(v_member_ids, 1), 0);
  if v_n = 0 then
    raise exception 'Group has no members';
  end if;

  for r_exp in
    select e.id, e.amount, e.paid_by, e.is_settlement, e.is_settled
    from public.expenses e
    where e.group_id = p_group_id
      and coalesce(e.is_settlement, false) = false
      and coalesce(e.is_settled, false) = false
  loop
    v_needs := false;

    if r_exp.paid_by is null then
      v_needs := true;
    elsif not (r_exp.paid_by = any (v_member_ids)) then
      v_needs := true;
    end if;

    if not v_needs then
      select exists (
        select 1
        from public.expense_splits es
        where es.expense_id = r_exp.id
          and not (es.user_id = any (v_member_ids))
      )
      into v_needs;
    end if;

    if not v_needs then
      continue;
    end if;

    -- Strip itemized data so splits are authoritative again.
    delete from public.expense_item_assignments a
    using public.expense_items ei
    where ei.expense_id = r_exp.id
      and a.expense_item_id = ei.id;

    delete from public.expense_items
    where expense_id = r_exp.id;

    if p_mode = 'redistribute' then
      update public.expenses
      set paid_by = v_owner
      where id = r_exp.id
        and (paid_by is null or not (paid_by = any (v_member_ids)));

      select coalesce(sum(es.amount_owed), 0)
      into v_absent_sum
      from public.expense_splits es
      where es.expense_id = r_exp.id
        and not (es.user_id = any (v_member_ids));

      delete from public.expense_splits es
      where es.expense_id = r_exp.id
        and not (es.user_id = any (v_member_ids));

      v_absent_cents := round(v_absent_sum * 100)::bigint;
      v_per_cents := case when v_n > 0 then v_absent_cents / v_n else 0 end;
      v_rem := case when v_n > 0 then (v_absent_cents % v_n)::int else 0 end;

      if v_absent_cents > 0 then
        v_idx := 0;
        foreach v_m in array v_member_ids
        loop
          v_add := (v_per_cents::numeric / 100.0);
          if v_idx < v_rem then
            v_add := v_add + 0.01;
          end if;
          v_idx := v_idx + 1;

          update public.expense_splits es
          set amount_owed = round(es.amount_owed + v_add, 2)
          where es.expense_id = r_exp.id
            and es.user_id = v_m;

          if not found then
            insert into public.expense_splits (expense_id, user_id, amount_owed)
            values (r_exp.id, v_m, round(v_add, 2));
          end if;
        end loop;
      end if;

      select coalesce(sum(es.amount_owed), 0)
      into v_sum_splits
      from public.expense_splits es
      where es.expense_id = r_exp.id;

      v_new_amt := round((r_exp.amount)::numeric, 2);
      if v_sum_splits is not null and v_sum_splits <> v_new_amt then
        v_mid := v_member_ids[1];
        update public.expense_splits es
        set amount_owed = round(es.amount_owed + (v_new_amt - v_sum_splits), 2)
        where es.expense_id = r_exp.id
          and es.user_id = v_mid;
      end if;

      v_updated := v_updated + 1;

    elsif p_mode = 'forgive' then
      delete from public.expense_splits es
      where es.expense_id = r_exp.id
        and not (es.user_id = any (v_member_ids));

      select coalesce(sum(es.amount_owed), 0)
      into v_sum_splits
      from public.expense_splits es
      where es.expense_id = r_exp.id;

      v_sum_splits := round(v_sum_splits, 2);

      if v_sum_splits <= 0 then
        delete from public.expense_splits where expense_id = r_exp.id;
        delete from public.expenses where id = r_exp.id;
        v_updated := v_updated + 1;
      else
        update public.expenses
        set
          amount = v_sum_splits,
          paid_by = case
            when paid_by is null or not (paid_by = any (v_member_ids)) then v_owner
            else paid_by
          end
        where id = r_exp.id;

        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('updated', v_updated);
end;
$$;

revoke all on function public.resolve_group_ex_members(uuid, text) from public;
grant execute on function public.resolve_group_ex_members(uuid, text) to authenticated;

commit;
