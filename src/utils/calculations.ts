/**
 * Tally.app – Debt calculation and settlement logic.
 * Every intermediate value is rounded to 2 decimals to avoid floating point noise and debt loops.
 */

/** Round to 2 decimals (cents). Use on every intermediate calculation. */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Below this, display as "Quadrat" and do not show in "Qui ha de pagar a qui". */
export const DISPLAY_SETTLED_THRESHOLD = 0.03;

/** Below this, force balance to zero and assign residual to principal creditor (avoids micro-debts after settlement). */
const ZERO_BALANCE_THRESHOLD = 0.05;

/** True if net balance is effectively zero for display (show as Quadrat). */
export function isSettled(net: number): boolean {
  return Math.abs(roundMoney(net)) < DISPLAY_SETTLED_THRESHOLD;
}

export interface BalanceRow {
  user_id: string;
  full_name: string;
  net: number;
}

export interface SettlementRow {
  from_user_id: string;
  from_name: string;
  to_user_id: string;
  to_name: string;
  amount: number;
}

/**
 * Step (a): Compute each user's NET BALANCE.
 * Every intermediate value is rounded to 2 decimals.
 * Owner adjustment: if sum of nets != 0, subtract that difference from the person with the highest positive balance (creditor principal absorbs rounding noise).
 * Zero-out: if |net| < 0.05, set to 0 and assign the residual to the principal creditor so no micro-debts appear after settlements.
 */
export function computeNetBalances(
  userTotals: { user_id: string; total_paid: number; total_owed: number }[],
  memberWithNames: { user_id: string; full_name: string }[]
): BalanceRow[] {
  const totalsByUser: Record<string, { paid: number; owed: number }> = {};
  userTotals.forEach((t) => {
    const paid = roundMoney(t.total_paid ?? 0);
    const owed = roundMoney(t.total_owed ?? 0);
    totalsByUser[t.user_id] = { paid, owed };
  });

  let balances: BalanceRow[] = memberWithNames.map((m) => {
    const totals = totalsByUser[m.user_id] ?? { paid: roundMoney(0), owed: roundMoney(0) };
    const paid = roundMoney(totals.paid ?? 0);
    const owed = roundMoney(totals.owed ?? 0);
    const net = roundMoney(paid - owed);
    return { user_id: m.user_id, full_name: m.full_name, net };
  });

  // Owner adjustment: sum must be exactly 0.00. If not, subtract the difference from the highest positive balance.
  let sum = roundMoney(balances.reduce((acc, b) => acc + b.net, 0));
  sum = roundMoney(sum);
  if (Math.abs(sum) >= 0.005) {
    const diff = roundMoney(-sum);
    const idx = balances.reduce((best, b, i) => (b.net > balances[best].net ? i : best), 0);
    balances = balances.map((b, i) =>
      i === idx ? { ...b, net: roundMoney(b.net + diff) } : b
    );
  }

  // Zero-out micro-balances: |net| < 0.05 → 0, and assign residual to principal creditor so sum stays 0.
  const creditorIdx = balances.reduce((best, b, i) => (b.net > balances[best].net ? i : best), 0);
  let residual = roundMoney(0);
  balances = balances.map((b, i) => {
    const abs = Math.abs(b.net);
    if (abs < ZERO_BALANCE_THRESHOLD && abs >= 0.005) {
      residual = roundMoney(residual + b.net);
      return { ...b, net: roundMoney(0) };
    }
    return b;
  });
  if (Math.abs(residual) >= 0.005) {
    balances = balances.map((b, i) =>
      i === creditorIdx ? { ...b, net: roundMoney(b.net + residual) } : b
    );
  }

  return balances;
}

/**
 * Debt simplification: minimum number of transactions.
 * Only includes transactions with amount >= DISPLAY_SETTLED_THRESHOLD (0.03) so micro-debts are hidden.
 */
export function computeSettlements(balances: BalanceRow[]): SettlementRow[] {
  const debtors = balances
    .filter((b) => roundMoney(b.net) < -DISPLAY_SETTLED_THRESHOLD)
    .map((b) => ({ id: b.user_id, name: b.full_name, net: roundMoney(-b.net) }));
  const creditors = balances
    .filter((b) => roundMoney(b.net) > DISPLAY_SETTLED_THRESHOLD)
    .map((b) => ({ id: b.user_id, name: b.full_name, net: roundMoney(b.net) }));

  const settlements: SettlementRow[] = [];

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort((a, b) => b.net - a.net);
    creditors.sort((a, b) => b.net - a.net);
    const d = debtors[0];
    const c = creditors[0];
    const amount = roundMoney(Math.min(d.net, c.net));
    if (amount < DISPLAY_SETTLED_THRESHOLD) break;

    settlements.push({
      from_user_id: d.id,
      from_name: d.name,
      to_user_id: c.id,
      to_name: c.name,
      amount,
    });

    d.net = roundMoney(d.net - amount);
    c.net = roundMoney(c.net - amount);
    if (d.net < DISPLAY_SETTLED_THRESHOLD) debtors.shift();
    if (c.net < DISPLAY_SETTLED_THRESHOLD) creditors.shift();
  }

  // Merge duplicate transfers between the same pair so we minimize transactions visually.
  const merged = new Map<string, SettlementRow>();
  for (const s of settlements) {
    const key = `${s.from_user_id}::${s.to_user_id}`;
    const existing = merged.get(key);
    if (existing) {
      existing.amount = roundMoney(existing.amount + s.amount);
    } else {
      merged.set(key, { ...s });
    }
  }

  return Array.from(merged.values()).filter((s) => roundMoney(s.amount) >= DISPLAY_SETTLED_THRESHOLD);
}
