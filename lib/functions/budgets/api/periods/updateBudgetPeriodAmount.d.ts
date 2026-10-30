/**
 * Update Budget Period Amount
 *
 * Callable behind the budget period amount editor. Every mode is defined against THE period
 * page's allocation rule (domain/budgets/period_allocation_view): the page builds every view's
 * allocation from the budget's MONTHLY `budget_periods` docs, so that is where edits land.
 *
 * - 'this_period' ("This Period Only"), any budget cadence, any edited period type: the page's
 *   current amount for the edited period (excluding its own earlier adjustment) is compared with
 *   the typed amount and the difference is stored as ONE adjustment
 *   `{ periodId, startMs, endMs, amount }` in `periodAdjustments` on the monthly doc(s) the
 *   period overlaps (split by overlap days, cents-exact, when it spans two months). Re-editing the
 *   same period REPLACES its adjustment (sets, never accumulates). The edited period's own doc
 *   gets `hasPeriodAdjustment` — the app's "custom amount" marker (a separate field, NOT
 *   `isModified`, so the legacy modifiedAmount sync trigger never fires and a stale legacy
 *   `modifiedAmount` can't be revived).
 * - `reset: true` ("Reset to Original"): removes the edited period's adjustment(s) and clears a
 *   legacy `modifiedAmount` / `isModified` on the edited doc.
 * - 'all_forward' ("All Periods Forward"): the budget's amount becomes typed ÷ the edited
 *   period's page share (domain/budgets/period_share), every override / adjustment from the edited
 *   period on is cleared, and the periods are re-allocated with the shared domain
 *   `compute_reallocated_periods` — so the edited period then shows what was typed.
 *
 * Past periods (ended before today, UTC) can't be edited. Every write path bumps the owner's
 * derive version AFTER writing (derive caches live 24h).
 *
 * Memory: 512MiB, Timeout: 60s
 */
type CascadeScope = "this_period" | "all_forward";
interface UpdateBudgetPeriodAmountRequest {
    budgetPeriodId: string;
    /** Not needed with `reset`. */
    newAmount?: number;
    /** Not needed with `reset` (a reset is always "This Period Only"). */
    cascadeScope?: CascadeScope;
    /** "Reset to Original": drop this period's "This Period Only" amount. */
    reset?: boolean;
}
interface UpdateBudgetPeriodAmountResponse {
    success: boolean;
    periodsUpdated: number;
    budgetUpdated: boolean;
    warnings: string[];
    error?: string;
}
export declare const updateBudgetPeriodAmount: import("firebase-functions/v2/https").CallableFunction<UpdateBudgetPeriodAmountRequest, Promise<UpdateBudgetPeriodAmountResponse>, unknown>;
export {};
//# sourceMappingURL=updateBudgetPeriodAmount.d.ts.map