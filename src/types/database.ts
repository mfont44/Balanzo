/**
 * Tally.app – Database types (Supabase SQL schema from README).
 * Use for type-safe API and RLS.
 */

export type UUID = string;

/** users – synced with Supabase Auth (id = auth.users.id) */
export interface User {
  id: UUID;
  full_name: string;
  avatar_url: string | null;
  is_pro: boolean;
  created_at?: string;
  /** Unique handle chosen during onboarding. */
  username?: string | null;
  /** ISO timestamp of last username change (15-day cooldown). */
  last_username_change?: string | null;
  /** First-run tutorial completion flag. DB column: has_completed_tutorial. */
  has_completed_tutorial?: boolean | null;
}

/** groups */
export interface Group {
  id: UUID;
  name: string;
  currency: string;
  created_by: UUID;
  created_at: string;
  /** Unique 6-char code for inviting (e.g. ABC123). Add column in Supabase if needed. */
  invite_code?: string | null;
}

/** group_members – junction table */
export interface GroupMember {
  group_id: UUID;
  user_id: UUID;
  joined_at: string;
}

/** expenses */
export interface Expense {
  id: UUID;
  group_id: UUID;
  paid_by: UUID;
  amount: number;
  description: string;
  date: string;
  is_ai_scanned: boolean;
  /** True when this row is a debt settlement (Quadrar), not a real expense for statistics. */
  is_settlement?: boolean;
  /** True when the expense was marked settled (group-wide liquidació). */
  is_settled?: boolean | null;
}

/** expense_splits – who owes what for an expense */
export interface ExpenseSplit {
  expense_id: UUID;
  user_id: UUID;
  amount_owed: number;
}

/** expense_items – itemized line items for an expense (Phase 2: Itemized Split) */
export interface ExpenseItem {
  id: UUID;
  expense_id: UUID;
  name: string;
  price: number;
  sort_order: number;
}

/** expense_item_assignments – which users are assigned to which item (participants for that item) */
export interface ExpenseItemAssignment {
  expense_item_id: UUID;
  user_id: UUID;
}
