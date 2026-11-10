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

import {
  compute_budget_spent,
  SplitForSpend,
} from "./budget_spend.service";
import { FeeSpend, PlaceSpend } from "./spend_breakdown.service";
import { PeriodInstanceType } from "./period_generation.service";
import {
  bucket_allocation_unpaused,
  MonthlyPeriodForDerivation,
  round2,
} from "./period_allocation_view.service";
import { PausedDayRange, is_paused_on, paused_days_in, utc_day } from "./budget_pause.service";

export type { MonthlyPeriodForDerivation };

/** A view's calendar bucket to derive (a weekly / bi-weekly source period). */
export interface ViewBucket {
  period_id: string;
  period_type: PeriodInstanceType;
  /** Inclusive bucket bounds, epoch ms. */
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
  /** `spent` per UTC calendar day of the bucket (index 0 = start day); Σ === spent to the cent. */
  daily_spent: number[];
  /** Purchases per UTC day (splits that add spend), indexed as `daily_spent`. */
  daily_count: number[];
  /** Counted spend by place (vendor key), top 8 by total, positive totals only. */
  places: PlaceSpend[];
  /** Bank fees among the counted spend, by kind (only kinds present). */
  fees: FeeSpend[];
  pending_spent: number;
  return_amount: number;
  /** effective_amount − spent (pro-rated rollover remaining). */
  remaining: number;
  /** Marker so read paths know this came from derivation, not a stored doc. */
  is_derived: true;
  /** Days of this bucket the budget is paused (PZ1/PZ5; 0 = not paused). */
  paused_days: number;
  /** Every day of the bucket is paused → the app shows "Paused" (sorted last); some → "Partly paused". */
  is_paused: boolean;
  /**
   * Everything-Else only: true when the period has NO expected income, so the FE
   * shows "add income to see what's left to spend" instead of the (meaningless)
   * negative leftover. See Everything-Else-Leftover-Limit.
   */
  no_income?: boolean;
  /** A Fund: its total and spending so far, through this period. `remaining` is what's left. */
  fund_total?: number;
  fund_spent_to_date?: number;
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
export function derive_budget_view_periods(
  budget_id: string,
  buckets: ViewBucket[],
  monthly_periods: MonthlyPeriodForDerivation[],
  splits: SplitForSpend[],
  active_start_ms?: number,
  active_end_ms?: number | null,
  priced?: { from_ms: number; to_ms: number | null },
  paused?: PausedDayRange[]
): DerivedBudgetViewPeriod[] {
  const result: DerivedBudgetViewPeriod[] = [];
  // A paused day's spending is Everything Else's (PZ1). The on-read owner rule already moved it;
  // this also covers callers that pass STORED-assignment splits (derive_budget_view "stored").
  const counted = paused && paused.length > 0
    ? splits.filter((s) => !is_paused_on(paused, s.txn_date_ms))
    : splits;
  for (const bucket of buckets) {
    // A budget must not appear in periods outside its active range — a bucket that ends before the
    // budget's first period (e.g. a newly-created budget shown in past periods) or starts after it
    // ended is omitted entirely. When the range is unset, all buckets are emitted (prior behavior).
    if (active_start_ms !== undefined && bucket.end_ms < active_start_ms) {
      continue;
    }
    if (active_end_ms != null && bucket.start_ms > active_end_ms) {
      continue;
    }
    const bucket_days = utc_day(bucket.end_ms) - utc_day(bucket.start_ms) + 1;
    const spend = compute_budget_spent(
      budget_id,
      bucket.start_ms,
      bucket.end_ms,
      counted,
      { start_ms: bucket.start_ms, days: bucket_days }
    );

    // THE page rule (domain/budgets/period_allocation_view): each overlapping monthly period's
    // daily amount × days overlapped, plus the "This Period Only" adjustments by their own range.
    // A pause (PZ1) takes the paused days' share out; spend on those days is already Everything
    // Else's (resolve_split_owner), so it never reaches `splits` here.
    const { allocated, effective } = bucket_allocation_unpaused(
      monthly_periods,
      bucket.start_ms,
      bucket.end_ms,
      priced,
      paused
    );
    const paused_days = paused_days_in(paused, bucket.start_ms, bucket.end_ms);

    result.push({
      budget_id,
      period_id: bucket.period_id,
      period_type: bucket.period_type,
      start_ms: bucket.start_ms,
      end_ms: bucket.end_ms,
      allocated_amount: allocated,
      effective_amount: effective,
      spent: spend.spent,
      daily_spent: spend.daily_spent ?? [],
      daily_count: spend.daily_count ?? [],
      places: spend.places ?? [],
      fees: spend.fees ?? [],
      pending_spent: spend.pending_spent,
      return_amount: spend.return_amount,
      remaining: round2(effective - spend.spent),
      is_derived: true,
      paused_days,
      is_paused: paused_days > 0 && paused_days >= bucket_days,
    });
  }
  return result;
}
