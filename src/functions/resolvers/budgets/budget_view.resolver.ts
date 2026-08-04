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

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { source_period_repo } from "../../repositories/source_period.repo";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { resolve_spend_splits } from "./budget_spend.resolver";
import { resolve_on_read_spend_splits } from "./on_read_spend.resolver";
import {
  ViewBucket,
  MonthlyPeriodForDerivation,
} from "../../domain/budgets/budget_view.service";
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
export async function resolve_budget_view_deps(
  ctx: TraceContext,
  user_id: string,
  budget_id: string,
  view_cadence: PeriodInstanceType,
  window_start_ms: number,
  window_end_ms: number,
  match_mode: SpendMatchMode = "stored",
  target_is_ee = false
): Promise<BudgetViewDeps> {
  // 1. The view's buckets: source periods of the requested cadence overlapping
  //    the window. get_overlapping returns every type; keep only this cadence.
  const overlapping = await source_period_repo.get_overlapping(
    ctx,
    Timestamp.fromMillis(window_start_ms),
    Timestamp.fromMillis(window_end_ms)
  );
  const buckets: ViewBucket[] = overlapping
    .filter((p) => p.period_type === view_cadence)
    .map((p) => ({
      period_id: p.period_id,
      period_type: view_cadence,
      start_ms: p.start_date.toMillis(),
      end_ms: p.end_date.toMillis(),
    }));

  if (buckets.length === 0) {
    return { buckets: [], monthly_periods: [], splits: [] };
  }

  // The actual data span is the union of the buckets (they can extend a little
  // past the requested window at the edges). Fetch monthly periods + splits over
  // that span so edge buckets pro-rate + sum correctly.
  const span_start_ms = Math.min(...buckets.map((b) => b.start_ms));
  const span_end_ms = Math.max(...buckets.map((b) => b.end_ms));

  // 2. The budget's materialized MONTHLY periods overlapping the span.
  const all_periods = await budget_period_repo.get_by_budget_id(ctx, budget_id);
  const monthly_periods: MonthlyPeriodForDerivation[] = all_periods
    .filter((p) => p.period_type === "monthly")
    .filter(
      (p) =>
        p.end_date.toMillis() >= span_start_ms &&
        p.start_date.toMillis() <= span_end_ms
    )
    .map((p) => ({
      allocated_amount: p.allocated_amount,
      effective_amount: p.effective_amount,
      start_ms: p.start_date.toMillis(),
      end_ms: p.end_date.toMillis(),
    }));

  // 3. The budget's splits over the span. Two modes:
  //    - "stored": read the pre-computed assignment (interim; matches today exactly).
  //    - "on_read": match splits to the budget on read (category + manual pin) — the
  //      "instant budgets" path; needs no write-time assignment.
  //    Either way they're re-bucketed by date in the domain.
  const splits =
    match_mode === "on_read"
      ? await resolve_on_read_spend_splits(
          ctx,
          user_id,
          budget_id,
          target_is_ee,
          span_start_ms,
          span_end_ms
        )
      : await resolve_spend_splits(ctx, user_id, budget_id, span_start_ms, span_end_ms, "monthly");

  return { buckets, monthly_periods, splits };
}
