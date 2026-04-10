/**
 * Tally.app – Groups API (Supabase).
 * RLS on public.groups restricts rows to those the authenticated user belongs to.
 */

import { supabase } from './supabase';
import type { Group } from '@/types/database';

export type GroupWithMemberCount = Group & { member_count: number };

async function getCurrentUserIdOrThrow(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw new Error(error.message ?? "No s'ha pogut validar la sessio.");
  if (!user?.id) throw new Error("Sessio invalida. Torna a iniciar sessio.");
  return user.id;
}

/**
 * Fetch groups where the current user is a member (join with group_members).
 * Only returns groups that have a row in group_members for the given userId.
 */
export async function fetchGroups(userId: string): Promise<GroupWithMemberCount[]> {
  const currentUserId = await getCurrentUserIdOrThrow();
  void userId;

  const { data, error } = await supabase
    .from('group_members')
    .select('groups(*, group_members(count))')
    .eq('user_id', currentUserId);

  if (error) throw error;

  type Row = { groups: Group & { group_members?: { count: number }[] | number } | null };
  const rows = (data ?? []) as Row[];
  const result: GroupWithMemberCount[] = [];

  for (const row of rows) {
    const g = row.groups;
    if (!g) continue;
    const { group_members, ...group } = g;
    const count = Array.isArray(group_members)
      ? group_members[0]?.count ?? 0
      : typeof group_members === 'number'
        ? group_members
        : 0;
    result.push({ ...group, member_count: count });
  }
  return result;
}

/**
 * Create a group with a unique invite_code and add the creator as a member.
 */
export async function createGroup(params: {
  name: string;
  currency: string;
  createdBy: string;
}): Promise<Group> {
  // Deprecated input kept for compatibility: owner is now always resolved server-side via auth.uid().
  void params.createdBy;
  await getCurrentUserIdOrThrow();
  const { data: groupId, error: rpcError } = await supabase.rpc('create_group_secure', {
    p_name: params.name,
    p_currency: params.currency,
  });
  if (rpcError) throw new Error(rpcError.message ?? 'No s\'ha pogut crear el grup');
  if (!groupId) throw new Error('No s\'ha retornat cap ID de grup');

  const { data: group, error: fetchError } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();
  if (fetchError || !group) throw new Error(fetchError?.message ?? 'No s\'ha pogut recuperar el grup creat');
  return group as Group;
}

/** Delete a group (only creator). Requires RLS: DELETE WHERE created_by = auth.uid() */
export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.from('groups').delete().eq('id', groupId);
  if (error) throw new Error(error.message ?? 'No s\'ha pogut eliminar el grup');
}

/** Find group by invite_code (for join flow). RLS may restrict; allow SELECT by invite_code for anon/authenticated. */
export async function fetchGroupByInviteCode(inviteCode: string): Promise<Group | null> {
  const normalized = String(inviteCode).trim().toUpperCase().slice(0, 6);
  if (normalized.length < 6) return null;
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('invite_code', normalized)
    .maybeSingle();
  if (error) return null;
  return data as Group | null;
}

/**
 * Secure join by invite code.
 * Uses SECURITY DEFINER RPC so it works even when RLS prevents reading `groups` by code.
 */
export async function joinGroupByCode(hexCode: string): Promise<string> {
  const normalized = String(hexCode).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const { data, error } = await supabase.rpc('join_group_by_code', {
    p_code: normalized,
  });
  if (error) throw new Error(error.message ?? 'No s\'ha pogut unir al grup');
  if (!data) throw new Error('No s\'ha pogut resoldre el grup del codi');
  const maybe = data as { group_id?: string; groupId?: string };
  const groupId = maybe.group_id ?? maybe.groupId;
  if (!groupId) throw new Error('No s\'ha pogut obtenir el group_id del codi.');
  return groupId;
}

/** Add current user to a group. Insert into group_members. Returns error and optional code (e.g. 23505 = already member). */
export async function addMemberToGroup(
  groupId: string,
  userId: string
): Promise<{ error: Error | null; code?: string }> {
  const currentUserId = await getCurrentUserIdOrThrow();
  if (userId !== currentUserId) {
    return {
      error: new Error('Per seguretat, només et pots afegir a tu mateix al grup.'),
      code: 'FORBIDDEN_USER_MISMATCH',
    };
  }
  const { error } = await supabase.from('group_members').insert({
    group_id: groupId,
    user_id: currentUserId,
    joined_at: new Date().toISOString(),
  });
  if (!error) return { error: null };
  return {
    error: new Error(error.message ?? 'No s\'ha pogut unir al grup'),
    code: error.code,
  };
}

/** Remove a member from a group (leave group). Deletes only the group_members row for that user. */
export async function leaveGroup(groupId: string, userId: string): Promise<{ error: Error | null }> {
  const currentUserId = await getCurrentUserIdOrThrow();
  if (userId !== currentUserId) {
    return { error: new Error('Per seguretat, només pots sortir del teu propi usuari.') };
  }
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', currentUserId);
  if (!error) return { error: null };
  return { error: new Error(error.message ?? 'No s\'ha pogut sortir del grup') };
}
