-- Tally.app — Fix infinite recursion in RLS policy evaluation
-- Date: 2026-03-26
--
-- Root cause:
-- - group_members INSERT policy used a WITH CHECK that SELECTed from public.groups
-- - public.groups SELECT policy checks membership via public.group_members
-- - This created a recursion cycle during INSERT policy evaluation ("infinite recursion detected").
--
-- Remediation:
-- - Simplify group_members INSERT policy to ONLY require user_id = auth.uid().
-- - Group existence is already enforced by FK constraints on group_members.group_id -> groups.id.

begin;

alter table public.group_members enable row level security;

drop policy if exists "group_members_insert_self_v2" on public.group_members;

create policy "group_members_insert_self_v2"
on public.group_members
for insert
to authenticated
with check (
  user_id = (select auth.uid())
);

commit;

