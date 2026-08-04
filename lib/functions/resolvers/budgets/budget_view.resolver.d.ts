/**
 * Budget View Resolver
 *
 * READ-ONLY dependency gathering for deriving a budget's non-monthly view
 * (Derive-On-Read Period Architecture — Phase 1). Fetches:
 *   1. the view's calendar buckets — the `source_periods` of the requested view
 *      cadence overlapping the visible window,
 *   2. the budget's materialized MONTHLY periods overlapping the window (carry
 *      allocated + effective for pro-ration), and
 *   3. the candidate splits, resolved against the budget's canonical (monthly /
 *      legacy) assignment over the window span — re-bucketed by date downstream.
 *
 * All reads are bounded to the visible window (the hard window bound from the
 * design). No writes.
 *
 * @module resolvers/budgets/budget_view
 */
import { TraceContext } from "../../types";
import { ViewBucket, MonthlyPeriodForDerivation } from "../../domain/budgets/budget_view.service";
import { PeriodInstanceType } from "../../domain/budgets";
import { SplitForSpend } from "../../domain/budgets/budget_spend.service";
/** Which spend-matching path to use for the derivation. */
export type SpendMatchMode = "stored" | "on_read";
/** Everything the derivation needs, gathered read-only. */
export interface BudgetViewDeps {
    buckets: ViewBucket[];
    monthly_periods: MonthlyPeriodForDerivation[];
    splits: SplitForSpend[];
}
/**
 * Gather the derivation inputs for `(budget, view_cadence, window)`.
 *
 * @param user_id      - Owner (for the splits query)
 * @param budget_id    - The budget being viewed
 * @param view_cadence - The cadence to derive (weekly / bi_monthly / monthly)
 * @param window_start_ms - Visible window start (inclusive), epoch ms
 * @param window_end_ms   - Visible window end (inclusive), epoch ms
 */
export declare function resolve_budget_view_deps(ctx: TraceContext, user_id: string, budget_id: string, view_cadence: PeriodInstanceType, window_start_ms: number, window_end_ms: number, match_mode?: SpendMatchMode, target_is_ee?: boolean): Promise<BudgetViewDeps>;
//# sourceMappingURL=budget_view.resolver.d.ts.map