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
export declare function is_countable(split: SplitForSpend): boolean;
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
export declare function compute_budget_spent(budget_id: string, period_start_ms: number, period_end_ms: number, splits: SplitForSpend[]): BudgetSpendResult;
//# sourceMappingURL=budget_spend.service.d.ts.map