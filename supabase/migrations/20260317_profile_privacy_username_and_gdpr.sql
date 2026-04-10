-- Tally.app — Profile & Privacy hardening (username + GDPR deletion)
-- Date: 2026-03-17
--
-- This migration:
-- 1) Enforces case-insensitive usernames via CITEXT + format/length CHECK.
-- 2) Updates FK delete behaviors for GDPR-safe deletions.
-- 3) Adds SECURITY DEFINER RPC delete_user_account() (self-service only).
-- 4) Ensures RLS is enabled on relevant tables (policies assumed to exist elsewhere).

begin;

-- -----------------------------------------------------------------------------
-- 1) USERNAME RULES: citext + format constraint
-- -----------------------------------------------------------------------------

create extension if not exists citext;

-- Convert username column to CITEXT (case-insensitive comparisons)
-- Normalize existing values: trim and empty-string → NULL
alter table public.users
  alter column username type citext
  using nullif(btrim(username), '')::citext;

-- Drop any existing UNIQUE constraint on username (unknown name) then recreate.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and contype = 'u'
      and conkey = array[
        (select attnum from pg_attribute where attrelid='public.users'::regclass and attname='username')
      ]
  loop
    execute format('alter table public.users drop constraint %I', c.conname);
  end loop;
end $$;

-- Create a partial unique index so multiple NULL usernames are allowed.
create unique index if not exists users_username_unique
  on public.users (username)
  where username is not null;

-- Username format: 3..24 chars, only [A-Za-z0-9_.]
alter table public.users
  drop constraint if exists users_username_format_check;

alter table public.users
  add constraint users_username_format_check
  check (
    username is null
    or (
      length(username) between 3 and 24
      and username ~ '^[A-Za-z0-9_.]+$'
    )
  );

-- -----------------------------------------------------------------------------
-- 3) DATA INTEGRITY: Foreign keys delete behaviors
-- -----------------------------------------------------------------------------

-- expenses.paid_by → auth.users.id ON DELETE SET NULL
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and contype = 'f'
      and array_position(conkey, (select attnum from pg_attribute where attrelid='public.expenses'::regclass and attname='paid_by')) is not null
  loop
    execute format('alter table public.expenses drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.expenses
  add constraint expenses_paid_by_fkey
  foreign key (paid_by) references auth.users(id) on delete set null;

-- group_members.user_id → auth.users.id ON DELETE CASCADE
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.group_members'::regclass
      and contype = 'f'
      and array_position(conkey, (select attnum from pg_attribute where attrelid='public.group_members'::regclass and attname='user_id')) is not null
  loop
    execute format('alter table public.group_members drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.group_members
  add constraint group_members_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- expense_splits.user_id → users.id ON DELETE CASCADE
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.expense_splits'::regclass
      and contype = 'f'
      and array_position(conkey, (select attnum from pg_attribute where attrelid='public.expense_splits'::regclass and attname='user_id')) is not null
  loop
    execute format('alter table public.expense_splits drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.expense_splits
  add constraint expense_splits_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

-- expense_item_assignments.user_id → users.id ON DELETE CASCADE
do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.expense_item_assignments'::regclass
      and contype = 'f'
      and array_position(conkey, (select attnum from pg_attribute where attrelid='public.expense_item_assignments'::regclass and attname='user_id')) is not null
  loop
    execute format('alter table public.expense_item_assignments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.expense_item_assignments
  add constraint expense_item_assignments_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

-- -----------------------------------------------------------------------------
-- 2) ACCOUNT DELETION (GDPR): SECURITY DEFINER RPC
-- -----------------------------------------------------------------------------

-- NOTE:
-- - This function must be OWNED by a privileged role in Supabase (e.g. postgres / service role context)
--   so it can delete from auth.users.
-- - It only targets auth.uid(); no parameters, so callers can only delete themselves.

create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public, auth
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

  -- Reassign ownership for groups created by the user.
  for g in
    select id
    from public.groups
    where created_by = v_uid
  loop
    select gm.user_id
    into v_new_owner
    from public.group_members gm
    join public.users u on u.id = gm.user_id
    where gm.group_id = g.id
      and gm.user_id <> v_uid
    order by gm.joined_at asc
    limit 1;

    -- If there is another member, transfer ownership.
    -- If there are no remaining members, set created_by to NULL (column is nullable in current DDL).
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

  -- Delete the public profile row (username is freed immediately).
  -- Related data should cascade / nullify via FKs configured above.
  delete from public.users where id = v_uid;

  -- GDPR: delete auth user (requires privileged owner).
  delete from auth.users where id = v_uid;
end;
$$;

-- Lock down execution: only authenticated users can call it.
revoke all on function public.delete_user_account() from public;
grant execute on function public.delete_user_account() to authenticated;

-- -----------------------------------------------------------------------------
-- 4) SECURITY & RLS: ensure RLS enabled (policies are assumed elsewhere)
-- -----------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.expense_item_assignments enable row level security;

commit;
