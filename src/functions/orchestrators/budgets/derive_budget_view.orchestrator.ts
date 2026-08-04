/**
 * Derive Budget View Orchestrator
 *
 * Read-only coordination for the Derive-On-Read Period Architecture (Phase 1):
 * derive a budget's non-monthly VIEW (weekly / bi-weekly) for a bounded visible
 * window, computed from the single materialized monthly home + the splits.
 *
 * No idempotency, no events, no writes — a read. All work is bounded to the
 * requested window (the hard window bound from the design).
 *
 * @module orchestrators/budgets/derive_budget_view
 */

import {
  TraceContext,
  PerformanceBudget,
  create_performance_metrics,
  is_budget_exceeded,
} from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import {
  resolve_budget_view_deps,
  SpendMatchMode,
} from "../../resolvers/budgets/budget_view.resolver";
import {
  derive_budget_view_periods,
  DerivedBudgetViewPeriod,
} from "../../domain/budgets/budget_view.service";
import { PeriodInstanceType } from "../../domain/budgets";

/** Read-only budget: derivation reads a bounded window; keep it generous. */
const BUDGET: PerformanceBudget = {
  max_reads: 60,
  max_writes: 0,
  max_time_ms: 500,
};

/** Input for a budget-view derivation. */
export interface DeriveBudgetViewInput {
  budget_id: string;
  view_cadence: PeriodInstanceType;
  window_start_ms: number;
  window_end_ms: number;
  /** How to source spent: "stored" (interim) or "on_read" (instant-budget match). */
  match_mode?: SpendMatchMode;
}

/** Result: the derived view periods + the denormalized budget name. */
export interface DeriveBudgetViewResult {
  budget_id: string;
  budget_name: string;
  view_cadence: PeriodInstanceType;
  periods: DerivedBudgetViewPeriod[];
}

/**
 * Derive a budget's view periods for a window. Returns `null` when the budget
 * doesn't exist or isn't owned by the caller (entry maps that to not-found).
 */
export async function derive_budget_view_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: DeriveBudgetViewInput
): Promise<DeriveBudgetViewResult | null> {
  const span = create_span(ctx, "orchestrator", "derive_budget_view");
  const perf = create_performance_metrics();
  log_operation_start(span, user_id);

  try {
    // 1. Load the budget + ownership check (shared-group access is a later,
    //    RBAC-owned concern; owner covers the parity gate + single-user case).
    const budget = await budget_repo.get_by_id(ctx, input.budget_id);
    perf.reads++;
    if (
      !budget ||
      (budget.user_id !== user_id && budget.owner_id !== user_id)
    ) {
      return null;
    }

    // 2. Gather derivation inputs (buckets + monthly periods + splits), bounded
    //    to the window.
    const deps = await resolve_budget_view_deps(
      ctx,
      user_id,
      input.budget_id,
      input.view_cadence,
      input.window_start_ms,
      input.window_end_ms,
      input.match_mode ?? "stored",
      budget.is_system_everything_else === true
    );
    perf.reads += input.match_mode === "on_read" ? 4 : 3;

    // 3. Pure derivation.
    const periods = derive_budget_view_periods(
      input.budget_id,
      deps.buckets,
      deps.monthly_periods,
      deps.splits
    );

    if (is_budget_exceeded(perf, BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] Performance budget exceeded for derive_budget_view`
      );
    }

    log_operation_success(span, user_id);

    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "derive_budget_view",
        status: "success",
        output: {
          view_cadence: input.view_cadence,
          bucket_count: deps.buckets.length,
          split_count: deps.splits.length,
        },
        context: { perf_reads: perf.reads },
      })
    );

    return {
      budget_id: input.budget_id,
      budget_name: budget.name,
      view_cadence: input.view_cadence,
      periods,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "DERIVE_BUDGET_VIEW_FAILED" }
    );
    throw error;
  }
}
