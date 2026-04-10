-- Tally.app — Prevent CASCADE delete of expense_splits / item_assignments when a user deletes their account.
-- Previously: ON DELETE CASCADE removed split rows and broke group balances; SET NULL on paid_by created orphans.
-- Now: user cannot delete public.users (profile) while they still appear on splits or item assignments.
-- expenses.paid_by remains ON DELETE SET NULL so historical payer-only references do not block GDPR deletion.

begin;

-- expense_splits.user_id → public.users(id)
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.expense_splits'::regclass
      and contype = 'f'
      and array_position(
        conkey,
        (select attnum from pg_attribute where attrelid = 'public.expense_splits'::regclass and attname = 'user_id')
      ) is not null
  loop
    execute format('alter table public.expense_splits drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.expense_splits
  add constraint expense_splits_user_id_fkey
  foreign key (user_id) references public.users(id) on delete restrict;

-- expense_item_assignments.user_id → public.users(id)
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.expense_item_assignments'::regclass
      and contype = 'f'
      and array_position(
        conkey,
        (select attnum from pg_attribute where attrelid = 'public.expense_item_assignments'::regclass and attname = 'user_id')
      ) is not null
  loop
    execute format('alter table public.expense_item_assignments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.expense_item_assignments
  add constraint expense_item_assignments_user_id_fkey
  foreign key (user_id) references public.users(id) on delete restrict;

-- Friendly error + same rules as FKs (runs before delete on public.users).
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

  if exists (select 1 from public.expense_splits where user_id = v_uid) then
    raise exception 'DELETE_ACCOUNT_BLOCKED_FINANCES' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.expense_item_assignments where user_id = v_uid) then
    raise exception 'DELETE_ACCOUNT_BLOCKED_FINANCES' using errcode = 'P0001';
  end if;

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

commit;
