-- Tally.app — Storage bucket `avatars` + RLS so uploads are not blocked.
-- Fixes: StorageApiError "new row violates row-level security policy" on upload.
--
-- App object keys: avatar_<auth.uid()>_<timestamp>.(jpg|gif)
-- Apply: supabase db push, or Supabase Dashboard → SQL → run this file.

begin;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "avatars_authenticated_insert_own" on storage.objects;
drop policy if exists "avatars_authenticated_update_own" on storage.objects;
drop policy if exists "avatars_authenticated_delete_own" on storage.objects;

-- Public read (needed for public avatar URLs)
create policy "avatars_public_read"
on storage.objects
for select
to public
using (bucket_id = 'avatars');

-- Upload only files named avatar_<my user id>_...
create policy "avatars_authenticated_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and name like 'avatar_' || auth.uid()::text || '_%'
);

create policy "avatars_authenticated_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and name like 'avatar_' || auth.uid()::text || '_%'
)
with check (
  bucket_id = 'avatars'
  and name like 'avatar_' || auth.uid()::text || '_%'
);

create policy "avatars_authenticated_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and name like 'avatar_' || auth.uid()::text || '_%'
);

commit;
