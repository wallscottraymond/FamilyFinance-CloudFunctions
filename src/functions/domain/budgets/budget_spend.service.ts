/**
 * Budget Spend Domain Service
 *
 * Pure, invalidation-based computation of a budget period's spent amount from the
 * transaction splits assigned to it. Spent is RECOMPUTED from the current splits
 * (never incremented), so it can't drift.
 *
 * Rules (from the spend-pipeline design):
 * - A split counts toward a budget period when it is assigned to that budget AND
 *   the transaction date is within the period's range AND it is "countable".
 * - **Countable** excludes: transfers, ignored splits, and recurring-mapped
 *   splits (`outflow_id`/`inflow_id` set — the recurring system tracks those).
 * - Refunds are NOT excluded — they carry a negative amount and net the spend
 *   down (a period can go negative = a net credit).
 * - The FULL split amount counts in EVERY overlapping period (the caller invokes
 *   this once per period; each period is an independent view).
 * - `pending_spent` is the pending-transaction portion of `spent`.
 *
 * NO async, NO IO, NO side effects. Time injected as epoch ms.
 *
 * @module domain/budgets/budget_spend
 */

/** A split + its transaction context, as the spend computation needs it. */
export interface SplitForSpend {
  budget_id: string;
  amount: number;
  txn_date_ms: number;
  /** Transaction-level: pending vs posted. */
  is_pending: boolean;
  /** Transaction-level: an internal transfer (excluded from budget spend). */
  is_transfer: boolean;
  /** Split-level exclude flag. */
  is_ignored: boolean;
  /** Recurring links — present ⇒ tracked by the recurring system, excluded here. */
  outflow_id: string | null;
  inflow_id: string | null;
}

/** Computed spend for one budget period. */
export interface BudgetSpendResult {
  spent: number;
  pending_spent: number;
}

/** Whether a split counts toward budget spend. PURE. */
export function is_countable(split: SplitForSpend): boolean {
  return (
    !split.is_transfer &&
    !split.is_ignored &&
    split.outflow_id === null &&
    split.inflow_id === null
  );
}

/** Round to 2 decimals. PURE. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recompute a budget period's spent + pending_spent from the splits.
 *
 * @param budget_id - The budget owning this period
 * @param period_start_ms - Period start (inclusive), epoch ms
 * @param period_end_ms - Period end (inclusive), epoch ms
 * @param splits - Candidate splits (any budget; this filters to `budget_id`)
 *
 * PURE FUNCTION.
 */
export function compute_budget_spent(
  budget_id: string,
  period_start_ms: number,
  period_end_ms: number,
  splits: SplitForSpend[]
): BudgetSpendResult {
  let spent = 0;
  let pending = 0;

  for (const split of splits) {
    if (split.budget_id !== budget_id) {
      continue;
    }
    if (split.txn_date_ms < period_start_ms || split.txn_date_ms > period_end_ms) {
      continue;
    }
    if (!is_countable(split)) {
      continue;
    }
    spent += split.amount;
    if (split.is_pending) {
      pending += split.amount;
    }
  }

  return { spent: round2(spent), pending_spent: round2(pending) };
}
