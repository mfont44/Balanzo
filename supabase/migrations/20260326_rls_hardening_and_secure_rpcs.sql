-- Tally.app — RLS hardening + secure RPC remediation
-- Date: 2026-03-26
--
-- This migration remediates security findings from audit:
-- 1) SECURITY DEFINER hardening for account deletion.
-- 2) Explicit RLS enablement and strict policies with WITH CHECK.
-- 3) New SECURITY INVOKER RPC create_group_secure() to avoid client-supplied owner IDs.

begin;

-- ============================================================================
-- 1) SECURITY DEFINER hardening (critical)
-- ============================================================================

create schema if not exists private;

-- Move privileged logic out of public schema.
drop function if exists private.delete_user_account();
create or replace function private.delete_user_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  g record;
  v_new_owner uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Transfer ownership for groups created by the caller.
  for g in
    select id
    from public.groups
    where created_by = v_uid
  loop
    select gm.user_id
      into v_new_owner
    from public.group_members gm
    where gm.group_id = g.id
      and gm.user_id <> v_uid
    order by gm.joined_at asc
    limit 1;

    if v_new_owner is null then
      update public.groups
      set created_by = null
      where id = g.id;
    else
      update public.groups
      set created_by = v_new_owner
      where id = g.id;
    end if;
  end loop;

  delete from public.users where id = v_uid;
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function private.delete_user_account() from public;
grant execute on function private.delete_user_account() to authenticated;

-- Keep public RPC name for app compatibility, but with no privileged logic.
drop function if exists public.delete_user_account();
create or replace function public.delete_user_account()
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.delete_user_account();
$$;

revoke all on function public.delete_user_account() from public;
grant execute on function public.delete_user_account() to authenticated;

-- ============================================================================
-- 2) RLS enablement + strict policies (high)
-- ============================================================================

alter table public.users enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.expense_items enable row level security;
alter table public.expense_item_assignments enable row level security;

-- -------------------------------
-- users
-- -------------------------------
drop policy if exists "users_select_own_v2" on public.users;
drop policy if exists "users_insert_own_v2" on public.users;
drop policy if exists "users_update_own_v2" on public.users;
drop policy if exists "users_delete_own_v2" on public.users;

create policy "users_select_own_v2"
on public.users
for select
to authenticated
using ((select auth.uid()) = id);

create policy "users_insert_own_v2"
on public.users
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "users_update_own_v2"
on public.users
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "users_delete_own_v2"
on public.users
for delete
to authenticated
using ((select auth.uid()) = id);

-- -------------------------------
-- groups
-- -------------------------------
drop policy if exists "groups_select_member_v2" on public.groups;
drop policy if exists "groups_insert_creator_v2" on public.groups;
drop policy if exists "groups_update_creator_v2" on public.groups;
drop policy if exists "groups_delete_creator_v2" on public.groups;

create policy "groups_select_member_v2"
on public.groups
for select
to authenticated
using (
  exists (
    select 1
    from public.group_members gm
    where gm.group_id = groups.id
      and gm.user_id = (select auth.uid())
  )
);

create policy "groups_insert_creator_v2"
on public.groups
for insert
to authenticated
with check (created_by = (select auth.uid()));

create policy "groups_update_creator_v2"
on public.groups
for update
to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

create policy "groups_delete_creator_v2"
on public.groups
for delete
to authenticated
using (created_by = (select auth.uid()));

-- -------------------------------
-- group_members
-- -------------------------------
drop policy if exists "group_members_select_member_v2" on public.group_members;
drop policy if exists "group_members_insert_self_v2" on public.group_members;
drop policy if exists "group_members_update_owner_or_self_v2" on public.group_members;
drop policy if exists "group_members_delete_owner_or_self_v2" on public.group_members;

create policy "group_members_select_member_v2"
on public.group_members
for select
to authenticated
using (
  exists (
    select 1
    from public.group_members gm
    where gm.group_id = group_members.group_id
      and gm.user_id = (select auth.uid())
  )
);

create policy "group_members_insert_self_v2"
on public.group_members
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.groups g
    where g.id = group_members.group_id
  )
);

create policy "group_members_update_owner_or_self_v2"
on public.group_members
for update
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.groups g
    where g.id = group_members.group_id
      and g.created_by = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.groups g
    where g.id = group_members.group_id
      and g.created_by = (select auth.uid())
  )
);

create policy "group_members_delete_owner_or_self_v2"
on public.group_members
for delete
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.groups g
    where g.id = group_members.group_id
      and g.created_by = (select auth.uid())
  )
);

-- -------------------------------
-- expenses
-- -------------------------------
drop policy if exists "expenses_select_group_member_v2" on public.expenses;
drop policy if exists "expenses_insert_member_paidby_self_v2" on public.expenses;
drop policy if exists "expenses_update_payer_only_v2" on public.expenses;
drop policy if exists "expenses_delete_payer_only_v2" on public.expenses;

create policy "expenses_select_group_member_v2"
on public.expenses
for select
to authenticated
using (
  exists (
    select 1
    from public.group_members gm
    where gm.group_id = expenses.group_id
      and gm.user_id = (select auth.uid())
  )
);

create policy "expenses_insert_member_paidby_self_v2"
on public.expenses
for insert
to authenticated
with check (
  paid_by = (select auth.uid())
  and exists (
    select 1
    from public.group_members gm
    where gm.group_id = expenses.group_id
      and gm.user_id = (select auth.uid())
  )
);

create policy "expenses_update_payer_only_v2"
on public.expenses
for update
to authenticated
using (
  paid_by = (select auth.uid())
  and exists (
    select 1
    from public.group_members gm
    where gm.group_id = expenses.group_id
      and gm.user_id = (select auth.uid())
  )
)
with check (
  paid_by = (select auth.uid())
  and exists (
    select 1
    from public.group_members gm
    where gm.group_id = expenses.group_id
      and gm.user_id = (select auth.uid())
  )
);

create policy "expenses_delete_payer_only_v2"
on public.expenses
for delete
to authenticated
using (
  paid_by = (select auth.uid())
  and exists (
    select 1
    from public.group_members gm
    where gm.group_id = expenses.group_id
      and gm.user_id = (select auth.uid())
  )
);

-- -------------------------------
-- expense_splits
-- -------------------------------
drop policy if exists "expense_splits_select_group_member_v2" on public.expense_splits;
drop policy if exists "expense_splits_insert_expense_payer_v2" on public.expense_splits;
drop policy if exists "expense_splits_update_expense_payer_v2" on public.expense_splits;
drop policy if exists "expense_splits_delete_expense_payer_v2" on public.expense_splits;

create policy "expense_splits_select_group_member_v2"
on public.expense_splits
for select
to authenticated
using (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_splits.expense_id
      and gm.user_id = (select auth.uid())
  )
);

create policy "expense_splits_insert_expense_payer_v2"
on public.expense_splits
for insert
to authenticated
with check (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_splits.expense_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
);

create policy "expense_splits_update_expense_payer_v2"
on public.expense_splits
for update
to authenticated
using (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_splits.expense_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_splits.expense_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
);

create policy "expense_splits_delete_expense_payer_v2"
on public.expense_splits
for delete
to authenticated
using (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_splits.expense_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
);

-- -------------------------------
-- expense_items
-- -------------------------------
drop policy if exists "expense_items_select_group_member_v2" on public.expense_items;
drop policy if exists "expense_items_insert_expense_payer_v2" on public.expense_items;
drop policy if exists "expense_items_update_expense_payer_v2" on public.expense_items;
drop policy if exists "expense_items_delete_expense_payer_v2" on public.expense_items;

create policy "expense_items_select_group_member_v2"
on public.expense_items
for select
to authenticated
using (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_items.expense_id
      and gm.user_id = (select auth.uid())
  )
);

create policy "expense_items_insert_expense_payer_v2"
on public.expense_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_items.expense_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
);

create policy "expense_items_update_expense_payer_v2"
on public.expense_items
for update
to authenticated
using (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_items.expense_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_items.expense_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
);

create policy "expense_items_delete_expense_payer_v2"
on public.expense_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.expenses e
    join public.group_members gm
      on gm.group_id = e.group_id
    where e.id = expense_items.expense_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
);

-- -------------------------------
-- expense_item_assignments
-- -------------------------------
drop policy if exists "expense_item_assignments_select_group_member_v2" on public.expense_item_assignments;
drop policy if exists "expense_item_assignments_insert_expense_payer_v2" on public.expense_item_assignments;
drop policy if exists "expense_item_assignments_update_expense_payer_v2" on public.expense_item_assignments;
drop policy if exists "expense_item_assignments_delete_expense_payer_v2" on public.expense_item_assignments;

create policy "expense_item_assignments_select_group_member_v2"
on public.expense_item_assignments
for select
to authenticated
using (
  exists (
    select 1
    from public.expense_items ei
    join public.expenses e
      on e.id = ei.expense_id
    join public.group_members gm
      on gm.group_id = e.group_id
    where ei.id = expense_item_assignments.expense_item_id
      and gm.user_id = (select auth.uid())
  )
);

create policy "expense_item_assignments_insert_expense_payer_v2"
on public.expense_item_assignments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.expense_items ei
    join public.expenses e
      on e.id = ei.expense_id
    join public.group_members gm
      on gm.group_id = e.group_id
    where ei.id = expense_item_assignments.expense_item_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
);

create policy "expense_item_assignments_update_expense_payer_v2"
on public.expense_item_assignments
for update
to authenticated
using (
  exists (
    select 1
    from public.expense_items ei
    join public.expenses e
      on e.id = ei.expense_id
    join public.group_members gm
      on gm.group_id = e.group_id
    where ei.id = expense_item_assignments.expense_item_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.expense_items ei
    join public.expenses e
      on e.id = ei.expense_id
    join public.group_members gm
      on gm.group_id = e.group_id
    where ei.id = expense_item_assignments.expense_item_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
);

create policy "expense_item_assignments_delete_expense_payer_v2"
on public.expense_item_assignments
for delete
to authenticated
using (
  exists (
    select 1
    from public.expense_items ei
    join public.expenses e
      on e.id = ei.expense_id
    join public.group_members gm
      on gm.group_id = e.group_id
    where ei.id = expense_item_assignments.expense_item_id
      and e.paid_by = (select auth.uid())
      and gm.user_id = (select auth.uid())
  )
);

-- ============================================================================
-- 3) Secure group creation RPC (high): remove client-trusted owner IDs
-- ============================================================================

drop function if exists public.create_group_secure(text, text);
create or replace function public.create_group_secure(
  p_name text,
  p_currency text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid;
  v_group_id uuid;
  v_invite_code text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- 6-char invite code, retries to avoid collisions.
  for i in 1..8 loop
    v_invite_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
    exit when not exists (
      select 1
      from public.groups g
      where g.invite_code = v_invite_code
    );
  end loop;

  if v_invite_code is null then
    raise exception 'Unable to generate invite code';
  end if;

  insert into public.groups (name, currency, created_by, created_at, invite_code)
  values (p_name, p_currency, v_uid, now(), v_invite_code)
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, joined_at)
  values (v_group_id, v_uid, now());

  return v_group_id;
end;
$$;

revoke all on function public.create_group_secure(text, text) from public;
grant execute on function public.create_group_secure(text, text) to authenticated;

commit;
