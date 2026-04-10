/**
 * Tally.app – Group members and group data (Supabase).
 * Uses two queries (no join) so it works when group_members.user_id FK points to auth.users.
 */

import { supabase } from './supabase';

export interface GroupMemberWithUser {
  user_id: string;
  full_name: string | null;
  email: string | null;
  username?: string | null;
  avatar_url?: string | null;
}

/**
 * Fetch group members with user details.
 * Two queries: group_members by group_id, then public.users by id list.
 * Avoids PGRST200 when group_members.user_id references auth.users (no join in schema).
 */
export async function fetchGroupMembers(groupId: string): Promise<GroupMemberWithUser[]> {
  const { data: memberRows, error: membersError } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId);

  if (membersError) {
    console.error('[Tally] fetchGroupMembers error:', membersError);
    return [];
  }

  const rows = (memberRows ?? []) as { user_id: string }[];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const { data: usersData, error: usersError } = await supabase
    .from('users')
    .select('id, full_name, username, avatar_url')
    .in('id', userIds);

  if (usersError) {
    console.error('[Tally] fetchGroupMembers users lookup error:', usersError);
    return [];
  }

  const userById = ((usersData ?? []) as {
    id: string;
    full_name: string | null;
    username: string | null;
    avatar_url?: string | null;
  }[]).reduce<
    Record<string, { full_name: string | null; username: string | null; avatar_url?: string | null }>
  >((acc, u) => {
    acc[u.id] = {
      full_name: u.full_name ?? null,
      username: u.username ?? null,
      avatar_url: u.avatar_url ?? null,
    };
    return acc;
  }, {});

  /** One row per group_members entry; merge public.users when present (ensurePublicUserFromAuthUser keeps rows in sync). */
  return rows.map((r) => ({
    user_id: r.user_id,
    full_name: userById[r.user_id]?.full_name ?? null,
    email: null,
    username: userById[r.user_id]?.username ?? null,
    avatar_url: userById[r.user_id]?.avatar_url ?? null,
  }));
}

/**
 * Display name: full_name if present; else first 5 chars of user_id (e.g. "User-0e63").
 * Never returns null, empty string, or the literal "null".
 */
export function getMemberDisplayName(m: GroupMemberWithUser): string {
  const name = (m.full_name ?? '').trim();
  if (name) return name;
  const email = (m.email ?? '').trim();
  if (email) return email.split('@')[0] || email;
  const id = (m.user_id ?? '').trim();
  if (id.length >= 5) return `User-${id.slice(0, 5)}`;
  if (id) return `User-${id}`;
  return 'User-?????';
}
