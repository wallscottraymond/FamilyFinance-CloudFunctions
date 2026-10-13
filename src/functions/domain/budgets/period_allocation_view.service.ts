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
export function utc_day_index(ms: number): number {
  const d = new Date(ms);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000
  );
}

/** Inclusive UTC-normalized day count for a range. PURE. */
export function days_inclusive(start_ms: number, end_ms: number): number {
  return utc_day_index(end_ms) - utc_day_index(start_ms) + 1;
}

/** Inclusive UTC-day overlap (in days) between two ranges. 0 if disjoint. PURE. */
export function overlap_days(
  a_start_ms: number,
  a_end_ms: number,
  b_start_ms: number,
  b_end_ms: number
): number {
  const start = Math.max(utc_day_index(a_start_ms), utc_day_index(b_start_ms));
  const end = Math.min(utc_day_index(a_end_ms), utc_day_index(b_end_ms));
  return end >= start ? end - start + 1 : 0;
}

/** Round to 2 decimals. PURE. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** An adjustment's share of a bucket, its range clipped to its month. PURE. */
function adjustment_in_bucket(
  adj: PeriodAdjustment,
  mp: MonthlyPeriodForDerivation,
  start_ms: number,
  end_ms: number
): number {
  const a_start = Math.max(adj.start_ms, mp.start_ms);
  const a_end = Math.min(adj.end_ms, mp.end_ms);
  if (utc_day_index(a_end) < utc_day_index(a_start)) return 0;
  const adj_days = days_inclusive(a_start, a_end);
  const days = overlap_days(a_start, a_end, start_ms, end_ms);
  return days === 0 ? 0 : (adj.amount * days) / adj_days;
}

/**
 * The page's allocation for the bucket [start_ms, end_ms] (inclusive): `allocated` (the budget
 * amount the page shows) and `effective` (incl. the monthly rollover), each rounded to cents.
 * PURE.
 */
export function bucket_allocation(
  monthly_periods: MonthlyPeriodForDerivation[],
  start_ms: number,
  end_ms: number
): { allocated: number; effective: number } {
  let allocated = 0;
  let effective = 0;
  for (const mp of monthly_periods) {
    const days = overlap_days(mp.start_ms, mp.end_ms, start_ms, end_ms);
    if (days === 0) continue;
    const mp_days = days_inclusive(mp.start_ms, mp.end_ms);
    if (mp_days <= 0) continue;
    allocated += (mp.allocated_amount / mp_days) * days;
    effective += (mp.effective_amount / mp_days) * days;
    for (const adj of mp.adjustments ?? []) {
      const extra = adjustment_in_bucket(adj, mp, start_ms, end_ms);
      allocated += extra;
      effective += extra;
    }
  }
  return { allocated: round2(allocated), effective: round2(effective) };
}

/**
 * Split an edited period's adjustment `amount` across the months it overlaps, by overlap days,
 * cents-exact (the parts sum to `amount`; the last part takes the rounding remainder). Each part's
 * range is the edited period clipped to that month. `months` are the monthly periods' bounds.
 * PURE.
 */
export function split_adjustment_by_month(
  period_id: string,
  start_ms: number,
  end_ms: number,
  amount: number,
  months: Array<{ start_ms: number; end_ms: number }>
): Array<{ month_index: number; adjustment: PeriodAdjustment }> {
  const parts = months
    .map((m, month_index) => ({
      month_index,
      start_ms: Math.max(start_ms, m.start_ms),
      end_ms: Math.min(end_ms, m.end_ms),
      days: overlap_days(start_ms, end_ms, m.start_ms, m.end_ms),
    }))
    .filter((p) => p.days > 0)
    .sort((a, b) => a.start_ms - b.start_ms);
  const total_days = parts.reduce((s, p) => s + p.days, 0);
  if (total_days === 0) return [];
  let assigned = 0;
  return parts.map((p, i) => {
    const part =
      i === parts.length - 1 ? round2(amount - assigned) : round2((amount * p.days) / total_days);
    assigned = round2(assigned + part);
    return {
      month_index: p.month_index,
      adjustment: { period_id, start_ms: p.start_ms, end_ms: p.end_ms, amount: part },
    };
  });
}
