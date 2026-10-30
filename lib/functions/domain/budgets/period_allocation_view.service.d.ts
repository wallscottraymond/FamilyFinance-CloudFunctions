/**
 * THE period-page allocation rule (Transaction-Integrity X10 — "This Period Only" for any view).
 *
 * The period page builds EVERY view's budget allocation (monthly, weekly, bi-monthly buckets) from
 * the budget's MONTHLY `budget_periods` docs only (derive's home for every budget). A bucket gets:
 *
 *   Σ over the monthly periods of  base ÷ month days × days the bucket overlaps the month
 * + Σ over each month's `periodAdjustments` of
 *                                  adj.amount × days(adj ∩ bucket) ÷ days(adj)
 *
 * An adjustment is the "This Period Only" extra dollars for ONE edited view period (its periodId,
 * e.g. "2031W28"), stored on the monthly doc(s) it overlaps, clipped to that month. The edited
 * bucket therefore gets the whole adjustment and every other bucket that doesn't overlap the edited
 * period gets none of it — whatever the budget's cadence or the edited period's type.
 *
 * Used by the period page (budget_view.service), the "This Period Only" callable (to know what the
 * page shows before the edit) and its unit tests — one rule, so the page always shows what was
 * typed. Day counting is UTC-inclusive. PURE.
 *
 * @module domain/budgets/period_allocation_view
 */
import { PeriodAdjustment } from "../../types/budgets/budget_entity.types";
export type { PeriodAdjustment };
/**
 * A materialized MONTHLY budget period, as the pro-ration needs it. `allocated_amount` /
 * `effective_amount` are the BASE amounts (legacy override ?? allocation; + rollover for
 * effective) WITHOUT adjustments — adjustments are spread by their own range, never by the month.
 */
export interface MonthlyPeriodForDerivation {
    allocated_amount: number;
    effective_amount: number;
    /** Inclusive period bounds, epoch ms. */
    start_ms: number;
    end_ms: number;
    /** "This Period Only" adjustments stored on this month (default none). */
    adjustments?: PeriodAdjustment[];
}
/** UTC day index (days since epoch) for a timestamp. PURE. */
export declare function utc_day_index(ms: number): number;
/** Inclusive UTC-normalized day count for a range. PURE. */
export declare function days_inclusive(start_ms: number, end_ms: number): number;
/** Inclusive UTC-day overlap (in days) between two ranges. 0 if disjoint. PURE. */
export declare function overlap_days(a_start_ms: number, a_end_ms: number, b_start_ms: number, b_end_ms: number): number;
/** Round to 2 decimals. PURE. */
export declare function round2(value: number): number;
/**
 * The page's allocation for the bucket [start_ms, end_ms] (inclusive): `allocated` (the budget
 * amount the page shows) and `effective` (incl. the monthly rollover), each rounded to cents.
 * PURE.
 */
export declare function bucket_allocation(monthly_periods: MonthlyPeriodForDerivation[], start_ms: number, end_ms: number): {
    allocated: number;
    effective: number;
};
/**
 * Split an edited period's adjustment `amount` across the months it overlaps, by overlap days,
 * cents-exact (the parts sum to `amount`; the last part takes the rounding remainder). Each part's
 * range is the edited period clipped to that month. `months` are the monthly periods' bounds.
 * PURE.
 */
export declare function split_adjustment_by_month(period_id: string, start_ms: number, end_ms: number, amount: number, months: Array<{
    start_ms: number;
    end_ms: number;
}>): Array<{
    month_index: number;
    adjustment: PeriodAdjustment;
}>;
/**
 * Keep the user's custom periods ABSOLUTE when a monthly doc's BASE allocation changes (a budget
 * amount change re-allocates the month). An adjustment is a delta on top of the month's
 * pro-rated base, so without this the page amount of its range would drift with the base. The
 * adjustments are rebased so the page shows the same figure for EVERY custom range:
 *
 *  - an adjustment overlapping no other one (the usual case): shift by the base change over its
 *    days, rounding each pro-rated term the way the page does (exact to the cent):
 *      amount' = round2(amount + round2(old_base × d ÷ D) − round2(new_base × d ÷ D))
 *  - adjustments that OVERLAP (a custom month + a custom week inside it, a half-month + a week):
 *    each one's page figure includes the others' share of its days, so they're solved TOGETHER —
 *    for each range i: Σ_j x_j · overlap(i, j) ÷ days(j) = Δ · days(i) ÷ D (x = the change in
 *    amount, Δ = old_base − new_base). Shifting each independently would count the base change
 *    twice on the overlap (a custom week inside a custom month would go negative).
 *
 * (d = the adjustment's days inside the month, D = the month's days.) `old_base` / `new_base`
 * are the doc's base as the page reads it (legacy override ?? allocation). PURE.
 */
export declare function rebase_adjustments(adjustments: PeriodAdjustment[], old_base: number, new_base: number, month_start_ms: number, month_end_ms: number): PeriodAdjustment[];
/** An existing period as a re-allocation's adjustment rebase needs it. */
export interface PeriodForRebase {
    id: string;
    start_ms: number;
    end_ms: number;
    /** The legacy direct override the page reads (direct_period_override), else null. */
    override: number | null;
    /** The stored allocation BEFORE the re-allocation. */
    allocated_amount: number;
    adjustments: PeriodAdjustment[];
    rolled_over_amount: number;
    spent: number;
}
/**
 * Apply `rebase_adjustments` to a re-allocation's updates (`compute_reallocated_periods`
 * output): each updated period carrying adjustments gets `period_adjustments` rebased from its
 * old base to its new one, and every update's `remaining` is the page's amount
 * (override ?? allocation + adjustments) + rollover − spent. Used by BOTH re-allocation paths
 * (update_budget → process_budget_updated, and "All Periods Forward"). PURE.
 */
export declare function rebase_reallocated_periods<U extends {
    id: string;
    allocated_amount: number;
    remaining: number;
}>(periods: PeriodForRebase[], updates: U[]): Array<U & {
    period_adjustments?: PeriodAdjustment[];
}>;
//# sourceMappingURL=period_allocation_view.service.d.ts.map