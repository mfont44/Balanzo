/**
 * Tally.app – Expenses & group detail API (Supabase).
 */

import { computeNetBalances, computeSettlements, roundMoney } from '@/utils/calculations';
import { inferStatsCategory } from '@/utils/expenseCategoryInference';
import { supabase } from './supabase';
import type { Group, Expense, ExpenseItem } from '@/types/database';

/** Matches canonical UUID strings (expense_splits.user_id must exist in public.users). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSplitUserId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && UUID_RE.test(value.trim());
}

async function getCurrentUserIdOrThrow(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw new Error(error.message ?? "No s'ha pogut validar la sessio.");
  if (!user?.id) throw new Error("Sessio invalida. Torna a iniciar sessio.");
  return user.id;
}

async function assertUserIdsAreGroupMembers(params: {
  groupId: string;
  userIds: string[];
  context: string;
}): Promise<string[]> {
  const { groupId, userIds, context } = params;
  const uniqueRequested = [...new Set(userIds.map((id) => String(id).trim()).filter(Boolean))];
  if (uniqueRequested.length === 0) return [];

  const { data: memberRows, error } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId);

  if (error) {
    throw new Error(error.message ?? `No s'ha pogut validar membres del grup (${context}).`);
  }

  const memberSet = new Set((memberRows ?? []).map((r) => (r as { user_id: string }).user_id).filter(Boolean));
  const filtered = uniqueRequested.filter((uid) => memberSet.has(uid));

  if (filtered.length !== uniqueRequested.length) {
    throw new Error("Un o més membres seleccionats no formen part d'aquest grup.");
  }

  return filtered;
}

type ExpenseSplitInsertRow = { expense_id: string; user_id: string; amount_owed: number };

function assertExpenseSplitsPayload(splits: ExpenseSplitInsertRow[], context: string): void {
  for (let i = 0; i < splits.length; i++) {
    const row = splits[i];
    if (!row || !isValidSplitUserId(row.user_id)) {
      const bad = row?.user_id;
      console.error(`[Tally] assertExpenseSplitsPayload (${context}): invalid user_id at index ${i}:`, bad);
      throw new Error(
        "ID d'usuari invàlid al repartiment. Assegura't que tots els membres tenen perfil (compte) a l'app."
      );
    }
  }
}

function logAndInsertExpenseSplits(splits: ExpenseSplitInsertRow[], context: string) {
  console.log('Splits Payload:', splits);
  if (__DEV__) console.log(`[Tally] Splits Payload (${context}):`, JSON.stringify(splits));
  assertExpenseSplitsPayload(splits, context);
  return supabase.from('expense_splits').insert(splits);
}

export interface GroupMemberWithUser {
  user_id: string;
  full_name: string;
}

export interface ExpenseWithPayer extends Expense {
  payer_name?: string;
  payer_avatar_url?: string | null;
}

/** Fetch a single group by id */
export async function fetchGroup(groupId: string): Promise<Group | null> {
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();
  if (error) return null;
  return data as Group;
}

/** Fetch expenses for a group with payer full_name (JOIN users). public.users has no email column. */
export async function fetchExpensesForGroup(groupId: string): Promise<ExpenseWithPayer[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, users!paid_by(id, full_name, avatar_url)')
    .eq('group_id', groupId)
    .order('date', { ascending: false });
  if (error) {
    return fetchExpensesForGroupFallback(groupId);
  }
  const rows = (data ?? []) as (Expense & { users: { full_name: string | null; avatar_url: string | null } | null })[];
  return rows.map((row) => {
    const { users, ...expense } = row;
    const name = (users?.full_name ?? '').trim() || '';
    return { ...expense, payer_name: name, payer_avatar_url: users?.avatar_url ?? null };
  });
}

/** Fallback: two queries when JOIN not available. */
async function fetchExpensesForGroupFallback(groupId: string): Promise<ExpenseWithPayer[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('group_id', groupId)
    .order('date', { ascending: false });
  if (error) return [];
  const expenses = (data ?? []) as (Expense & { paid_by?: string | null })[];
  if (expenses.length === 0) return [];
  const paidByIds = [...new Set(expenses.map((e) => e.paid_by).filter(Boolean))] as string[];
  const nameByUserId: Record<string, string> = {};
  const avatarByUserId: Record<string, string | null> = {};
  if (paidByIds.length > 0) {
    const { data: usersData } = await supabase
      .from('users')
      .select('id, full_name, avatar_url')
      .in('id', paidByIds);
    (usersData ?? []).forEach((u) => {
      const row = u as { id: string; full_name: string | null; avatar_url: string | null };
      nameByUserId[row.id] = (row.full_name ?? '').trim() || '';
      avatarByUserId[row.id] = row.avatar_url ?? null;
    });
  }
  return expenses.map((e) => ({
    ...e,
    payer_name: e.paid_by ? (nameByUserId[e.paid_by] ?? '') : '',
    payer_avatar_url: e.paid_by ? (avatarByUserId[e.paid_by] ?? null) : null,
  }));
}

/** Fetch group members with full_name from users (JOIN). */
export async function fetchGroupMembersWithUsers(groupId: string): Promise<GroupMemberWithUser[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('user_id, users(full_name)')
    .eq('group_id', groupId);
  if (error) return [];
  const rows = (data ?? []) as unknown as { user_id: string; users: { full_name: string } | null }[];
  return rows.map((r) => ({
    user_id: r.user_id,
    full_name: (r.users?.full_name ?? '').trim(),
  }));
}

/**
 * Sum of non-settlement expense amounts that are not marked settled (“no quadrades”),
 * aligned with ExpensesTab (real expenses only; excludes is_settlement rows).
 */
export async function fetchUnsettledExpenseTotalsByGroupIds(
  groupIds: string[]
): Promise<Record<string, number>> {
  const unique = [...new Set(groupIds.map((id) => String(id).trim()).filter(Boolean))];
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from('expenses')
    .select('group_id, amount, is_settlement, is_settled')
    .in('group_id', unique);

  if (error || !data) {
    return Object.fromEntries(unique.map((id) => [id, 0]));
  }

  const totals: Record<string, number> = Object.fromEntries(unique.map((id) => [id, 0]));

  for (const row of data) {
    const r = row as {
      group_id: string;
      amount: unknown;
      is_settlement?: boolean | null;
      is_settled?: boolean | null;
    };
    if (r.is_settlement === true) continue;
    if (r.is_settled === true) continue;
    const gid = String(r.group_id ?? '');
    if (!(gid in totals)) continue;
    const amt = roundMoney(Number(r.amount) ?? 0);
    totals[gid] = roundMoney((totals[gid] ?? 0) + amt);
  }

  return totals;
}

/**
 * Reassign orphan expenses (paid_by is null, e.g. payer deleted account) to the group creator.
 * Use when the creator wants to "liquidate" these so balances recompute correctly.
 */
export async function liquidateOrphanExpenses(
  groupId: string,
  assignToUserId: string
): Promise<{ error: Error | null }> {
  const { error } = await supabase
    .from('expenses')
    .update({ paid_by: assignToUserId })
    .eq('group_id', groupId)
    .is('paid_by', null);
  if (!error) return { error: null };
  return { error: new Error(error.message ?? 'No s\'han pogut liquidar les despeses') };
}

/**
 * True when some active expense references a payer or split participant who is no longer in the group.
 * Does not include paid_by null (handled separately via liquidateOrphanExpenses).
 * Prefer DB RPC `group_has_stale_participants` when deployed; falls back to client-side checks.
 */
export async function fetchGroupHasStaleParticipants(
  groupId: string,
  memberUserIds: string[]
): Promise<boolean> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('group_has_stale_participants', {
    p_group_id: groupId,
  });
  if (!rpcError && rpcData !== null && rpcData !== undefined) {
    return Boolean(rpcData);
  }

  const memberSet = new Set(memberUserIds.map((id) => String(id).trim()).filter(Boolean));
  if (memberSet.size === 0) return false;

  const { data: rows, error } = await supabase
    .from('expenses')
    .select('id, paid_by, is_settlement, is_settled')
    .eq('group_id', groupId);

  if (error || !rows?.length) return false;

  const candidates = (
    rows as {
      id: string;
      paid_by: string | null;
      is_settlement?: boolean | null;
      is_settled?: boolean | null;
    }[]
  ).filter((e) => e.is_settlement !== true && e.is_settled !== true);
  if (candidates.length === 0) return false;

  for (const e of candidates) {
    if (e.paid_by != null && !memberSet.has(e.paid_by)) return true;
  }

  const ids = candidates.map((e) => e.id);
  if (ids.length === 0) return false;

  const { data: splits } = await supabase
    .from('expense_splits')
    .select('user_id')
    .in('expense_id', ids);

  for (const s of splits ?? []) {
    const uid = String((s as { user_id: string }).user_id ?? '').trim();
    if (uid && !memberSet.has(uid)) return true;
  }
  return false;
}

function isMissingRpcInSchemaCache(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('schema cache') ||
    m.includes('could not find the function') ||
    (m.includes('function') && m.includes('does not exist'))
  );
}

/** Creator-only: redistribute former members' shares or forgive their debt (see Supabase RPC). */
export async function resolveGroupExMembers(
  groupId: string,
  mode: 'redistribute' | 'forgive'
): Promise<{ error: Error | null; updated?: number }> {
  const args = { p_group_id: groupId, p_mode: mode };
  const rpcNames = ['resolve_group_ex_members', 'resolve_grup_ex_members'] as const;
  let lastMessage: string | undefined;
  for (const name of rpcNames) {
    const { data, error } = await supabase.rpc(name, args);
    if (!error) {
      const payload = data as { updated?: number } | null;
      const updated = typeof payload?.updated === 'number' ? payload.updated : undefined;
      return { error: null, updated };
    }
    lastMessage = error.message;
    if (!isMissingRpcInSchemaCache(error.message)) {
      return { error: new Error(error.message ?? 'No s\'ha pogut actualitzar les despeses') };
    }
  }
  return { error: new Error(lastMessage ?? 'No s\'ha pogut actualitzar les despeses') };
}

/**
 * Create an expense (a) and its expense_splits (b).
 * (a) Inserts one row into 'expenses' with paid_by = current/selected user ID.
 * (b) Inserts one row per member into 'expense_splits' with amount_owed = amount / member count.
 */
export async function createExpenseWithSplits(params: {
  groupId: string;
  paidBy: string;
  amount: number;
  description: string;
  memberUserIds: string[];
  isAiScanned?: boolean;
}): Promise<Expense> {
  const {
    groupId,
    paidBy,
    amount,
    description,
    memberUserIds,
    isAiScanned = false,
  } = params;
  const uniqueMemberIds = [...new Set(memberUserIds.map((id) => String(id).trim()).filter(Boolean))];
  if (uniqueMemberIds.length === 0) throw new Error('Selecciona almenys una persona.');
  const amountPerPerson = Math.round((amount / uniqueMemberIds.length) * 100) / 100;

  // Security: never trust frontend-provided user IDs; ensure every participant is in group_members.
  // Also validate paid_by is an actual group member (but do NOT require it to equal auth.uid()).
  const allowedPaidByIds = await assertUserIdsAreGroupMembers({
    groupId,
    userIds: [paidBy],
    context: 'createExpenseWithSplits:paid_by',
  });
  if (allowedPaidByIds.length !== 1) throw new Error('El pagador seleccionat no forma part d\'aquest grup.');

  const allowedMemberIds = await assertUserIdsAreGroupMembers({
    groupId,
    userIds: uniqueMemberIds,
    context: 'createExpenseWithSplits',
  });
  if (allowedMemberIds.length === 0) throw new Error('Selecciona almenys una persona.');

  const splitsPayload = allowedMemberIds.map((user_id) => ({
    user_id,
    amount_owed: amountPerPerson,
  }));

  const { data: rpcResult, error: rpcError } = await supabase.rpc('create_expense_secure', {
    p_group_id: groupId,
    p_paid_by: paidBy,
    p_amount: Number(amount),
    p_description: String(description),
    p_category: inferStatsCategory(String(description)),
    p_date: new Date().toISOString(),
    p_splits: splitsPayload,
    p_is_ai_scanned: Boolean(isAiScanned),
    p_is_settlement: false,
  });

  if (rpcError) throw new Error(rpcError.message ?? 'No s\'ha pogut crear la despesa.');

  // Support multiple possible return shapes.
  const maybeObj = rpcResult as unknown as Partial<Expense> & { id?: string; expense_id?: string };
  if (maybeObj && typeof maybeObj === 'object' && maybeObj.id) return maybeObj as Expense;
  const expenseId = typeof rpcResult === 'string' ? rpcResult : maybeObj?.expense_id ?? maybeObj?.id;
  if (!expenseId) throw new Error('No s\'ha pogut recuperar la despesa creada.');

  const { data: expense } = await supabase.from('expenses').select('*').eq('id', expenseId).single();
  if (!expense) throw new Error('No s\'ha pogut recuperar la despesa.');
  return expense as Expense;
}

/**
 * Round split amounts to 2 decimals and apply remainder to the first split so the sum matches totalAmount.
 */
export function reconcileCustomSplitAmounts(
  splits: { user_id: string; amount_owed: number }[],
  totalAmount: number
): { user_id: string; amount_owed: number }[] {
  if (splits.length === 0) throw new Error('Cal assignar almenys un membre.');
  const roundedSplits = splits.map((s) => ({
    ...s,
    amount_owed: Math.round(s.amount_owed * 100) / 100,
  }));
  const sum = roundedSplits.reduce((a, s) => a + s.amount_owed, 0);
  const diff = Math.round((totalAmount - sum) * 100) / 100;
  if (Math.abs(diff) >= 0.01 && roundedSplits.length > 0) {
    const first = roundedSplits[0];
    if (first) {
      first.amount_owed = Math.round((first.amount_owed + diff) * 100) / 100;
    }
  }

  const rows = roundedSplits
    .filter((s) => s.amount_owed > 0)
    .map((s) => ({
      user_id: String(s.user_id).trim(),
      amount_owed: s.amount_owed,
    }));

  if (rows.length === 0) throw new Error('Cal assignar almenys un import major que 0.');
  return rows;
}

/**
 * Create one expense with custom splits (e.g. from AI receipt assignment).
 * Sum of amount_owed across splits should equal totalAmount; amounts are rounded to 2 decimals.
 */
export async function createExpenseWithCustomSplits(params: {
  groupId: string;
  paidBy: string;
  amount: number;
  description: string;
  splits: { user_id: string; amount_owed: number }[];
  isAiScanned?: boolean;
}): Promise<Expense> {
  const {
    groupId,
    paidBy,
    amount,
    description,
    splits,
    isAiScanned = false,
  } = params;

  const rows = reconcileCustomSplitAmounts(splits, amount);

  // Security: ensure split participants are legitimate members of this group.
  // Also validate paid_by is an actual group member (but do NOT require it to equal auth.uid()).
  const allowedPaidByIds = await assertUserIdsAreGroupMembers({
    groupId,
    userIds: [paidBy],
    context: 'createExpenseWithCustomSplits:paid_by',
  });
  if (allowedPaidByIds.length !== 1) throw new Error('El pagador seleccionat no forma part d\'aquest grup.');

  const allowedSplitUserIds = await assertUserIdsAreGroupMembers({
    groupId,
    userIds: rows.map((r) => r.user_id),
    context: 'createExpenseWithCustomSplits',
  });

  // Preserve computed rounding, but enforce allowed subset.
  const allowedSet = new Set(allowedSplitUserIds);
  const splitsPayload = rows.filter((r) => allowedSet.has(r.user_id)).map((r) => ({
    user_id: r.user_id,
    amount_owed: r.amount_owed,
  }));
  if (splitsPayload.length === 0) {
    throw new Error('Cal assignar almenys un membre amb import vàlid al repartiment.');
  }

  // Validate payload format (client-side) before sending.
  assertExpenseSplitsPayload(
    splitsPayload.map((s) => ({ expense_id: '00000000-0000-0000-0000-000000000000', ...s })),
    'createExpenseWithCustomSplits'
  );

  const { data: rpcResult, error: rpcError } = await supabase.rpc('create_expense_secure', {
    p_group_id: groupId,
    p_paid_by: paidBy,
    p_amount: Number(amount),
    p_description: String(description),
    p_category: inferStatsCategory(String(description)),
    p_date: new Date().toISOString(),
    p_splits: splitsPayload,
    p_is_ai_scanned: Boolean(isAiScanned),
    p_is_settlement: false,
  });

  if (rpcError) throw new Error(rpcError.message ?? 'No s\'ha pogut crear la despesa.');

  const maybeObj = rpcResult as unknown as Partial<Expense> & { id?: string; expense_id?: string };
  if (maybeObj && typeof maybeObj === 'object' && maybeObj.id) return maybeObj as Expense;
  const expenseId = typeof rpcResult === 'string' ? rpcResult : maybeObj?.expense_id ?? maybeObj?.id;
  if (!expenseId) throw new Error('No s\'ha pogut recuperar la despesa creada.');

  const { data: expense } = await supabase.from('expenses').select('*').eq('id', expenseId).single();
  if (!expense) throw new Error('No s\'ha pogut recuperar la despesa.');
  return expense as Expense;
}

export interface MemberBalance {
  user_id: string;
  full_name: string;
  net: number; // positive = owed to them, negative = they owe
}

export interface Settlement {
  from_user_id: string;
  from_name: string;
  to_user_id: string;
  to_name: string;
  amount: number;
}

/** Itemized item for create (name, price, participant user ids). */
export interface ExpenseItemInput {
  name: string;
  price: number;
  participant_user_ids: string[];
}

/**
 * Create an expense with itemized products. All totals and splits are computed in the DB RPC.
 * Frontend only collects items (name, price) and participant_user_ids per item.
 */
export async function createExpenseWithItems(params: {
  groupId: string;
  paidBy: string;
  description: string;
  items: ExpenseItemInput[];
}): Promise<Expense> {
  const { groupId, paidBy, description, items } = params;
  if (items.length === 0) throw new Error('Cal almenys un producte.');
  const p_items = items.map((i) => ({
    name: String(i.name).trim(),
    price: Number(i.price),
    participant_user_ids: Array.isArray(i.participant_user_ids) ? i.participant_user_ids : [],
  }));
  const { data: expenseId, error } = await supabase.rpc('create_expense_with_items', {
    p_group_id: groupId,
    p_paid_by: paidBy,
    p_description: description.trim(),
    p_items,
  });
  if (error) throw new Error(error.message ?? 'No s\'ha pogut crear la despesa.');
  const { data: expense, error: fetchError } = await supabase
    .from('expenses')
    .select('*')
    .eq('id', expenseId)
    .single();
  if (fetchError || !expense) throw new Error('No s\'ha pogut recuperar la despesa.');
  return expense as Expense;
}

/** Fetch itemized items for an expense (for view mode). */
export async function fetchExpenseItems(expenseId: string): Promise<ExpenseItem[]> {
  const { data, error } = await supabase
    .from('expense_items')
    .select('*')
    .eq('expense_id', expenseId)
    .order('sort_order', { ascending: true });
  if (error) return [];
  return (data ?? []) as ExpenseItem[];
}

/** Item with participant user ids (for edit mode hydration). */
export interface ExpenseItemWithAssignments {
  id: string;
  name: string;
  price: number;
  sort_order: number;
  participant_user_ids: string[];
}

/** Fetch itemized items with their participant user ids (for edit screen). */
export async function fetchExpenseItemsWithAssignments(expenseId: string): Promise<ExpenseItemWithAssignments[]> {
  const items = await fetchExpenseItems(expenseId);
  if (items.length === 0) return [];
  const itemIds = items.map((i) => i.id);
  const { data: assignments, error } = await supabase
    .from('expense_item_assignments')
    .select('expense_item_id, user_id')
    .in('expense_item_id', itemIds);
  if (error) return items.map((i) => ({ ...i, participant_user_ids: [] }));
  const byItemId: Record<string, string[]> = {};
  for (const a of assignments ?? []) {
    const id = (a as { expense_item_id: string; user_id: string }).expense_item_id;
    if (!byItemId[id]) byItemId[id] = [];
    byItemId[id].push((a as { expense_item_id: string; user_id: string }).user_id);
  }
  return items.map((i) => ({
    id: i.id,
    name: i.name,
    price: i.price,
    sort_order: i.sort_order,
    participant_user_ids: byItemId[i.id] ?? [],
  }));
}

/** Fetch one expense and its splits (for edit flow). */
export async function getExpenseWithSplits(expenseId: string): Promise<{
  expense: ExpenseWithPayer;
  splits: { user_id: string; amount_owed: number }[];
} | null> {
  const { data: expense, error: exError } = await supabase
    .from('expenses')
    .select('*')
    .eq('id', expenseId)
    .single();
  if (exError || !expense) return null;
  const { data: splitRows } = await supabase
    .from('expense_splits')
    .select('user_id, amount_owed')
    .eq('expense_id', expenseId);
  const splits = (splitRows ?? []).map((s) => ({ user_id: s.user_id, amount_owed: Number(s.amount_owed) }));
  return { expense: expense as ExpenseWithPayer, splits };
}

/**
 * Net balances + simplified settlements.
 * Omits expenses with is_settled = true so “Quadrar el grup” (settle_group_debts) zeros the UI.
 */
export async function fetchGroupBalances(
  groupId: string,
  memberWithNames: { user_id: string; full_name: string }[]
): Promise<{ balances: MemberBalance[]; settlements: Settlement[] }> {
  if (memberWithNames.length === 0) {
    return { balances: [], settlements: [] };
  }

  const memberIds = new Set(memberWithNames.map((m) => m.user_id));

  const { data: expenseRows, error: exError } = await supabase
    .from('expenses')
    .select('id, paid_by, amount, is_settled')
    .eq('group_id', groupId);

  if (exError) {
    return { balances: [], settlements: [] };
  }

  const activeExpenses = (expenseRows ?? []).filter((e) => {
    const row = e as { is_settled?: boolean | null };
    return row.is_settled !== true;
  }) as { id: string; paid_by: string | null; amount: number }[];

  const totalsPaid: Record<string, number> = {};
  const totalsOwed: Record<string, number> = {};

  for (const e of activeExpenses) {
    const amt = roundMoney(Number(e.amount) ?? 0);
    const payer = e.paid_by?.trim();
    if (payer && memberIds.has(payer)) {
      totalsPaid[payer] = roundMoney((totalsPaid[payer] ?? 0) + amt);
    }
  }

  const activeIds = activeExpenses.map((e) => e.id);
  if (activeIds.length > 0) {
    const { data: splitRows, error: spError } = await supabase
      .from('expense_splits')
      .select('user_id, amount_owed')
      .in('expense_id', activeIds);

    if (!spError && splitRows) {
      for (const s of splitRows as { user_id: string; amount_owed: number }[]) {
        const uid = String(s.user_id ?? '').trim();
        if (!memberIds.has(uid)) continue;
        const owed = roundMoney(Number(s.amount_owed) ?? 0);
        totalsOwed[uid] = roundMoney((totalsOwed[uid] ?? 0) + owed);
      }
    }
  }

  const userTotals = memberWithNames.map((m) => ({
    user_id: m.user_id,
    total_paid: totalsPaid[m.user_id] ?? 0,
    total_owed: totalsOwed[m.user_id] ?? 0,
  }));

  const balances = computeNetBalances(userTotals, memberWithNames);
  const settlements = computeSettlements(balances);
  return { balances, settlements };
}

/**
 * Record a settlement: "fromUser paid toUser amount".
 * Implemented as an expense: paid_by = fromUser, amount; one split: toUser, amount_owed.
 * This offsets the debt without affecting other members.
 */
export async function createSettlementExpense(params: {
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
}): Promise<Expense> {
  const { groupId, fromUserId, toUserId, amount } = params;
  const rounded = roundMoney(amount);
  if (rounded < 0.01) throw new Error('L\'import ha de ser almenys 0,01.');

  // Security: ensure recipient is an actual member of the group.
  const uniqueRequested = [...new Set([fromUserId, toUserId].map((x) => String(x).trim()).filter(Boolean))];
  const allowedUserIds = await assertUserIdsAreGroupMembers({
    groupId,
    userIds: uniqueRequested,
    context: 'createSettlementExpense',
  });
  if (allowedUserIds.length !== uniqueRequested.length) {
    throw new Error("No pots liquidar amb usuaris que no formen part del grup.");
  }

  const splitsPayload = [
    {
      user_id: String(toUserId).trim(),
      amount_owed: rounded,
    },
  ];

  const { data: rpcResult, error: rpcError } = await supabase.rpc('create_expense_secure', {
    p_group_id: groupId,
    p_paid_by: fromUserId,
    p_amount: rounded,
    p_description: 'Liquidació (Marcat com a pagat)',
    p_category: inferStatsCategory('Liquidació (Marcat com a pagat)'),
    p_date: new Date().toISOString(),
    p_splits: splitsPayload,
    p_is_ai_scanned: false,
    p_is_settlement: true,
  });

  if (rpcError) throw new Error(rpcError.message ?? 'No s\'ha pogut registrar el pagament.');

  const maybeObj = rpcResult as unknown as Partial<Expense> & { id?: string; expense_id?: string };
  if (maybeObj && typeof maybeObj === 'object' && maybeObj.id) return maybeObj as Expense;
  const expenseId = typeof rpcResult === 'string' ? rpcResult : maybeObj?.expense_id ?? maybeObj?.id;
  if (!expenseId) throw new Error('No s\'ha pogut recuperar el pagament creat.');

  const { data: expense } = await supabase.from('expenses').select('*').eq('id', expenseId).single();
  if (!expense) throw new Error('No s\'ha pogut registrar el pagament.');
  return expense as Expense;
}

/** Delete an expense and its splits. Caller must ensure user can delete (e.g. not a settlement or only creator). */
export async function deleteExpense(expenseId: string): Promise<void> {
  const { error: splitsError } = await supabase.from('expense_splits').delete().eq('expense_id', expenseId);
  if (splitsError) throw new Error(splitsError.message ?? 'No s\'han pogut eliminar els repartiments.');
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
  if (error) throw new Error(error.message ?? 'No s\'ha pogut eliminar la despesa.');
}

/** Delete all expense_items and their assignments for an expense. Must run before inserting new items to avoid duplicates. */
async function deleteExpenseItemsAndAssignments(expenseId: string): Promise<void> {
  const { data: existingItems } = await supabase
    .from('expense_items')
    .select('id')
    .eq('expense_id', expenseId);
  const ids = (existingItems ?? []).map((r) => (r as { id: string }).id);
  if (ids.length > 0) {
    const { error: assignErr } = await supabase
      .from('expense_item_assignments')
      .delete()
      .in('expense_item_id', ids);
    if (assignErr) throw new Error(assignErr.message ?? 'No s\'han pogut eliminar les assignacions.');
  }
  const { error: itemsErr } = await supabase.from('expense_items').delete().eq('expense_id', expenseId);
  if (itemsErr) throw new Error(itemsErr.message ?? 'No s\'han pogut eliminar els productes.');
}

/** Update an expense and replace its splits (for edit flow). Clears itemized data when switching to equal/select split. */
export async function updateExpense(
  expenseId: string,
  params: {
    paidBy: string;
    amount: number;
    description: string;
    memberUserIds: string[];
    date?: string;
  }
): Promise<Expense> {
  const { paidBy, amount, description, memberUserIds, date } = params;
  const uniqueMemberIds = [...new Set(memberUserIds.map((id) => String(id).trim()).filter(Boolean))];
  if (uniqueMemberIds.length === 0) throw new Error('Selecciona almenys una persona.');
  const amountPerPerson = Math.round((amount / uniqueMemberIds.length) * 100) / 100;

  await deleteExpenseItemsAndAssignments(expenseId);

  const updatePayload: { paid_by: string; amount: number; description: string; date?: string } = {
    paid_by: paidBy,
    amount: Number(amount),
    description: String(description),
  };
  if (date) updatePayload.date = date;

  const { error: updateError } = await supabase
    .from('expenses')
    .update(updatePayload)
    .eq('id', expenseId);
  if (updateError) throw new Error(updateError.message ?? 'No s\'ha pogut actualitzar la despesa.');

  const { error: deleteSplitsError } = await supabase.from('expense_splits').delete().eq('expense_id', expenseId);
  if (deleteSplitsError) {
    throw new Error(deleteSplitsError.message ?? 'No s\'han pogut reemplaçar els repartiments.');
  }
  const splits: ExpenseSplitInsertRow[] = uniqueMemberIds.map((user_id) => ({
    expense_id: expenseId,
    user_id,
    amount_owed: amountPerPerson,
  }));
  const { error: splitsError } = await logAndInsertExpenseSplits(splits, 'updateExpense');
  if (splitsError) throw new Error(splitsError.message ?? 'No s\'han pogut desar els repartiments.');

  const { data } = await supabase.from('expenses').select('*').eq('id', expenseId).single();
  if (!data) throw new Error('Despesa no trobada.');
  return data as Expense;
}

/** Update an expense with custom split amounts (e.g. percentage split). Clears itemized rows. */
export async function updateExpenseWithCustomSplits(
  expenseId: string,
  params: {
    paidBy: string;
    amount: number;
    description: string;
    splits: { user_id: string; amount_owed: number }[];
    date?: string;
  }
): Promise<Expense> {
  const { paidBy, amount, description, splits, date } = params;

  const { data: existing, error: fetchGroupErr } = await supabase
    .from('expenses')
    .select('group_id')
    .eq('id', expenseId)
    .single();
  if (fetchGroupErr || !existing) throw new Error('Despesa no trobada.');
  const groupId = (existing as { group_id: string }).group_id;

  const rows = reconcileCustomSplitAmounts(splits, amount);

  const allowedPaidByIds = await assertUserIdsAreGroupMembers({
    groupId,
    userIds: [paidBy],
    context: 'updateExpenseWithCustomSplits:paid_by',
  });
  if (allowedPaidByIds.length !== 1) throw new Error('El pagador seleccionat no forma part d\'aquest grup.');

  const allowedSplitUserIds = await assertUserIdsAreGroupMembers({
    groupId,
    userIds: rows.map((r) => r.user_id),
    context: 'updateExpenseWithCustomSplits',
  });
  const allowedSet = new Set(allowedSplitUserIds);
  const splitsPayload = rows.filter((r) => allowedSet.has(r.user_id)).map((r) => ({
    user_id: r.user_id,
    amount_owed: r.amount_owed,
  }));
  if (splitsPayload.length === 0) throw new Error('Selecciona almenys una persona vàlida per al repartiment.');

  assertExpenseSplitsPayload(
    splitsPayload.map((s) => ({ expense_id: '00000000-0000-0000-0000-000000000000', ...s })),
    'updateExpenseWithCustomSplits'
  );

  await deleteExpenseItemsAndAssignments(expenseId);

  const updatePayload: { paid_by: string; amount: number; description: string; date?: string } = {
    paid_by: paidBy,
    amount: Number(amount),
    description: String(description),
  };
  if (date) updatePayload.date = date;

  const { error: updateError } = await supabase.from('expenses').update(updatePayload).eq('id', expenseId);
  if (updateError) throw new Error(updateError.message ?? 'No s\'ha pogut actualitzar la despesa.');

  const { error: deleteSplitsError } = await supabase.from('expense_splits').delete().eq('expense_id', expenseId);
  if (deleteSplitsError) {
    throw new Error(deleteSplitsError.message ?? 'No s\'han pogut reemplaçar els repartiments.');
  }

  const insertRows: ExpenseSplitInsertRow[] = splitsPayload.map((s) => ({
    expense_id: expenseId,
    user_id: s.user_id,
    amount_owed: s.amount_owed,
  }));
  const { error: splitsError } = await logAndInsertExpenseSplits(insertRows, 'updateExpenseWithCustomSplits');
  if (splitsError) throw new Error(splitsError.message ?? 'No s\'han pogut desar els repartiments.');

  const { data } = await supabase.from('expenses').select('*').eq('id', expenseId).single();
  if (!data) throw new Error('Despesa no trobada.');
  return data as Expense;
}

/** Update an itemized expense: strict 2-step DELETE old items then INSERT new. No upsert, no merge. */
export async function updateExpenseWithItems(
  expenseId: string,
  params: { description: string; paidBy: string; items: ExpenseItemInput[] }
): Promise<Expense> {
  const { description, paidBy, items } = params;
  if (items.length === 0) throw new Error('Cal almenys un producte.');
  const total = items.reduce((s, i) => s + Number(i.price), 0);
  const totalRounded = Math.round(total * 100) / 100;

  const { error: updateErr } = await supabase
    .from('expenses')
    .update({ description: description.trim(), amount: totalRounded, paid_by: paidBy })
    .eq('id', expenseId);
  if (updateErr) throw new Error(updateErr.message ?? 'No s\'ha pogut actualitzar la despesa.');

  const { data: existingRows } = await supabase
    .from('expense_items')
    .select('id')
    .eq('expense_id', expenseId);
  const ids = (existingRows ?? []).map((r) => (r as { id: string }).id);
  if (ids.length > 0) {
    const { error: assignDelErr } = await supabase
      .from('expense_item_assignments')
      .delete()
      .in('expense_item_id', ids);
    if (assignDelErr) throw new Error('Failed to delete old assignments: ' + assignDelErr.message);
  }

  const { error: deleteError } = await supabase
    .from('expense_items')
    .delete()
    .eq('expense_id', expenseId);
  if (deleteError) throw new Error('Failed to delete old items: ' + deleteError.message);

  const newItemsArrayWithExpenseId = items.map((it, i) => ({
    expense_id: expenseId,
    name: String(it.name).trim(),
    price: Number(it.price),
    sort_order: i,
  }));

  const { data: insertedRows, error: insertError } = await supabase
    .from('expense_items')
    .insert(newItemsArrayWithExpenseId)
    .select('id');
  if (insertError) throw new Error('Failed to insert new items: ' + insertError.message);

  const inserted = (insertedRows ?? []) as { id: string }[];
  const assignmentRows: { expense_item_id: string; user_id: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const userIds = Array.isArray(items[i].participant_user_ids) ? items[i].participant_user_ids : [];
    if (inserted[i]) {
      for (const uid of userIds) {
        assignmentRows.push({ expense_item_id: inserted[i].id, user_id: uid });
      }
    }
  }
  if (assignmentRows.length > 0) {
    const { error: assignErr } = await supabase.from('expense_item_assignments').insert(assignmentRows);
    if (assignErr) throw new Error(assignErr.message ?? 'No s\'han pogut desar les assignacions.');
  }

  const amountByUser: Record<string, number> = {};
  for (let i = 0; i < items.length; i++) {
    const userIds = Array.isArray(items[i].participant_user_ids) ? items[i].participant_user_ids : [];
    if (userIds.length === 0) continue;
    const perPerson = Math.round((Number(items[i].price) / userIds.length) * 100) / 100;
    for (const uid of userIds) {
      amountByUser[uid] = (amountByUser[uid] ?? 0) + perPerson;
    }
  }
  const { error: delSplitsErr } = await supabase.from('expense_splits').delete().eq('expense_id', expenseId);
  if (delSplitsErr) throw new Error(delSplitsErr.message ?? 'No s\'han pogut actualitzar els repartiments.');

  const splitRows: ExpenseSplitInsertRow[] = Object.entries(amountByUser).map(([user_id, amount_owed]) => ({
    expense_id: expenseId,
    user_id: String(user_id).trim(),
    amount_owed: Math.round(amount_owed * 100) / 100,
  }));
  if (splitRows.length > 0) {
    const { error: splitErr } = await logAndInsertExpenseSplits(splitRows, 'updateExpenseWithItems');
    if (splitErr) throw new Error(splitErr.message ?? 'No s\'han pogut desar els repartiments.');
  }

  const { data, error: fetchErr } = await supabase.from('expenses').select('*').eq('id', expenseId).single();
  if (fetchErr || !data) throw new Error('Despesa no trobada.');
  return data as Expense;
}

/**
 * Quadrar el grup: salda tots els deutes pendents entre membres d’un sol cop
 * (equivalent a haver pagat tot el que calia), marcant les despeses com a liquidades via RPC.
 */
export async function settleAllGroupExpenses(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('settle_group_debts', { p_group_id: groupId });
  if (error) throw new Error(error.message ?? "No s'han pogut quadrar els deutes del grup.");
}

/**
 * After a manual settlement payment, if no simplified transfers remain (same condition as an empty
 * “Qui ha de pagar a qui” list), mark non-settlement expenses as settled — matching “Quadrar el grup”.
 */
export async function markGroupExpensesSettledWhenFullySquare(
  groupId: string,
  memberWithNames: { user_id: string; full_name: string }[]
): Promise<void> {
  const { settlements } = await fetchGroupBalances(groupId, memberWithNames);
  if (settlements.length > 0) return;
  await settleAllGroupExpenses(groupId);
}
