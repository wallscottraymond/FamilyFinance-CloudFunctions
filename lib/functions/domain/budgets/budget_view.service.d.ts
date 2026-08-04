/**
 * Budget View Derivation Domain Service
 *
 * Derive-On-Read Period Architecture — Phase 1.
 *
 * PURE, deterministic derivation of a budget's weekly / bi-weekly VIEW from its
 * single materialized MONTHLY home. Instead of storing a budget_period per
 * cadence, we compute the non-monthly views on read:
 *
 *   - `spent` for a view bucket = the SAME windowed sum the stored path uses
 *     (`compute_budget_spent` over the splits whose date falls in the bucket).
 *     A split's budget assignment is cadence-INDEPENDENT — it belongs to the
 *     budget in every view, only the date window changes — so the caller passes
 *     the splits resolved against the budget's canonical (monthly/legacy)
 *     assignment.
 *   - `allocated` / `effective` (the limit) for a view bucket = the overlapping
 *     monthly period(s)' amount PRO-RATED by overlapping days (daily-rate ×
 *     days-overlapped), summed. `effective` folds in the monthly rollover chain,
 *     so `remaining = pro-rated monthly effective − spent` (locked decision:
 *     rollover lives on the monthly chain; non-monthly views pro-rate it).
 *
 * This function stores nothing and reads nothing. All IO (fetch the monthly
 * periods, the view's source-period buckets, and the splits) happens in the
 * resolver; time/dates arrive as epoch ms.
 *
 * @module domain/budgets/budget_view
 */
import { SplitForSpend } from "./budget_spend.service";
import { PeriodInstanceType } from "./period_generation.service";
/** A view's calendar bucket to derive (a weekly / bi-weekly source period). */
export interface ViewBucket {
    period_id: string;
    period_type: PeriodInstanceType;
    /** Inclusive bucket bounds, epoch ms. */
    start_ms: number;
    end_ms: number;
}
/**
 * A materialized MONTHLY budget period, as the pro-ration needs it. `effective`
 * = allocated + rolled_over (the amount the user actually has this month).
 */
export interface MonthlyPeriodForDerivation {
    allocated_amount: number;
    effective_amount: number;
    /** Inclusive period bounds, epoch ms. */
    start_ms: number;
    end_ms: number;
}
/** A single derived view period (never persisted; shaped for read mapping). */
export interface DerivedBudgetViewPeriod {
    budget_id: string;
    period_id: string;
    period_type: PeriodInstanceType;
    start_ms: number;
    end_ms: number;
    /** Pro-rated base limit for this bucket. */
    allocated_amount: number;
    /** Pro-rated limit incl. monthly rollover (allocated + rolled_over). */
    effective_amount: number;
    spent: number;
    pending_spent: number;
    return_amount: number;
    /** effective_amount − spent (pro-rated rollover remaining). */
    remaining: number;
    /** Marker so read paths know this came from derivation, not a stored doc. */
    is_derived: true;
}
/**
 * Derive the view periods for a budget in one view cadence + visible window.
 *
 * @param budget_id       - The budget being viewed
 * @param buckets         - The view's source-period buckets (weekly/bi-weekly)
 * @param monthly_periods - The budget's materialized MONTHLY periods overlapping
 *                          the window (carry allocated + effective for pro-ration)
 * @param splits          - Candidate splits assigned to `budget_id`, resolved
 *                          over the whole window against the canonical (monthly)
 *                          assignment. Each is re-bucketed by date here.
 *
 * PURE FUNCTION.
 */
export declare function derive_budget_view_periods(budget_id: string, buckets: ViewBucket[], monthly_periods: MonthlyPeriodForDerivation[], splits: SplitForSpend[]): DerivedBudgetViewPeriod[];
//# sourceMappingURL=budget_view.service.d.ts.map