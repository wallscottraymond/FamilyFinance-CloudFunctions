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
 * - **Countable** excludes: transfers, `ignored` splits, and recurring-mapped
 *   splits (`outflow_id`/`inflow_id` set — the recurring system tracks those).
 * - **`refund` splits stay countable** (you paid → still in `spent`), but their
 *   |amount| ALSO accrues into a parallel `return_amount` = the user's *expected*
 *   returns (Split-Status-Actions). `return_amount` does NOT reduce `spent`; the UI
 *   derives net = `spent − return_amount`. (A real negative Plaid credit is a
 *   separate posted txn that nets `spent` down on its own.)
 * - The FULL split amount counts in EVERY overlapping period (the caller invokes
 *   this once per period; each period is an independent view).
 * - `pending_spent` is the pending-transaction portion of `spent`.
 *
 * NO async, NO IO, NO side effects. Time injected as epoch ms.
 *
 * @module domain/budgets/budget_spend
 */

/** A split's budget-spend treatment (mirrors the `SpendStatus` type). */
export type SpendStatusForSpend = "counted" | "ignored" | "refund";

/** A split + its transaction context, as the spend computation needs it. */
export interface SplitForSpend {
  budget_id: string;
  amount: number;
  txn_date_ms: number;
  /** Transaction-level: pending vs posted. */
  is_pending: boolean;
  /** Transaction-level: an internal transfer (excluded from budget spend). */
  is_transfer: boolean;
  /** Transaction-level: a credit (`type: "income"`). Real income is excluded via
   *  `is_income_category`; a credit in an EXPENSE category is a one-off return that
   *  reverses (reduces) spent. */
  is_income: boolean;
  /** Effective category is a Plaid `INCOME_*` category ⇒ real income, not a purchase
   *  return — excluded from budget spend entirely (belongs to inflows). */
  is_income_category: boolean;
  /** Split-level spend treatment (resolver derives it from spendStatus/legacy flags). */
  spend_status: SpendStatusForSpend;
  /** Recurring links — present ⇒ tracked by the recurring system, excluded here. */
  outflow_id: string | null;
  inflow_id: string | null;
}

/** Computed spend for one budget period. */
export interface BudgetSpendResult {
  spent: number;
  pending_spent: number;
  /** Σ|amount| of the countable `refund` splits — expected returns (parallel to spent). */
  return_amount: number;
}

// Plaid category semantics (transfer/income) live in the transactions domain so
// the routing engine and this read-time calc share ONE definition. Re-exported
// here for the existing budget read-path imports.
export {
  is_transfer_category,
  is_income_category,
} from "../transactions/category_semantics.service";

/**
 * Whether a split counts toward budget `spent`. Excludes transfers, real income,
 * ignored splits, and recurring-linked splits. `refund` and one-off income
 * returns stay countable (the latter reverse spend — see compute_budget_spent). PURE.
 */
export function is_countable(split: SplitForSpend): boolean {
  return (
    !split.is_transfer &&
    !split.is_income_category &&
    split.spend_status !== "ignored" &&
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
  let return_amount = 0;

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
    // A one-off income return (a credit in an expense category, e.g. an item
    // refund) comes in positive and REVERSES that portion of spend. Everything
    // else adds. Amounts are stored positive; direction comes from `is_income`.
    const magnitude = Math.abs(split.amount);
    const signed = split.is_income ? -magnitude : split.amount;
    spent += signed;
    if (split.is_pending) {
      pending += signed;
    }
    // Refund splits and income returns accrue their magnitude as an expected return.
    if (split.is_income || split.spend_status === "refund") {
      return_amount += magnitude;
    }
  }

  return {
    spent: round2(spent),
    pending_spent: round2(pending),
    return_amount: round2(return_amount),
  };
}
