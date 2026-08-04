/**
 * Derive Period Orchestrator (batched)
 *
 * Read-only coordination for a whole period view in ONE call: budgets (derived,
 * on-read matched), bills, and income for the requested cadence + window. Loads
 * the shared data once (resolver) then loops the pure services in memory —
 * collapsing the client's ~N callable round-trips into one and removing the
 * per-item re-reads.
 *
 * @module orchestrators/periods/derive_period
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
import { resolve_period_derivation_deps } from "../../resolvers/periods/period_derivation.resolver";
import {
  derive_budget_view_periods,
  DerivedBudgetViewPeriod,
} from "../../domain/budgets/budget_view.service";
import { owned_splits_for_budget } from "../../domain/budgets/budget_spend_match.service";
import { generate_expected_occurrences_in_window } from "../../domain/outflows/outflow_period.service";
import {
  reconcile_occurrences,
  reconcile_income_occurrences,
  ExpectedOccurrence,
} from "../../domain/recurring/reconcile_occurrences.service";
import {
  place_occurrences,
  PlacedOccurrenceGroup,
} from "../../domain/recurring/occurrence_placement.service";
import { PeriodInstanceType } from "../../domain/budgets";

const BUDGET: PerformanceBudget = { max_reads: 200, max_writes: 0, max_time_ms: 1500 };

export interface DerivePeriodInput {
  view_cadence: PeriodInstanceType;
  window_start_ms: number;
  window_end_ms: number;
}

export interface DerivedBudgetResult {
  budget_id: string;
  name: string;
  is_everything_else: boolean;
  periods: DerivedBudgetViewPeriod[];
}
export interface DerivedRecurringResult {
  recurring_id: string;
  name: string;
  groups: PlacedOccurrenceGroup[];
}
export interface DerivePeriodResult {
  view_cadence: PeriodInstanceType;
  budgets: DerivedBudgetResult[];
  bills: DerivedRecurringResult[];
  income: DerivedRecurringResult[];
}

export async function derive_period_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: DerivePeriodInput
): Promise<DerivePeriodResult> {
  const span = create_span(ctx, "orchestrator", "derive_period");
  const perf = create_performance_metrics();
  log_operation_start(span, user_id);

  try {
    const deps = await resolve_period_derivation_deps(
      ctx,
      user_id,
      input.view_cadence,
      input.window_start_ms,
      input.window_end_ms
    );
    perf.reads += 6;

    // Budgets — on-read match + derive (all from the shared splits, in memory).
    const budgets: DerivedBudgetResult[] = deps.budgets.map((b) => {
      const ee_id = b.is_ee ? b.id : deps.monthly_ee_id ?? deps.any_ee_id;
      const owned = owned_splits_for_budget(b.id, deps.real_budgets, ee_id, deps.splits_for_match);
      const periods = derive_budget_view_periods(b.id, deps.view_buckets, b.monthly_periods, owned);
      return { budget_id: b.id, name: b.name, is_everything_else: b.is_ee, periods };
    });

    // Bills + income — generate → reconcile → place (in memory).
    const bills: DerivedRecurringResult[] = [];
    const income: DerivedRecurringResult[] = [];
    for (const r of deps.recurring) {
      let reconciled;
      if (r.kind === "inflow") {
        // Income: paid = the actual linked deposits (Plaid transaction_ids), NOT
        // synthesized occurrences; outstanding = the projected next receipt.
        reconciled = reconcile_income_occurrences(
          r.id,
          r.payments,
          r.schedule.predicted_next_date ? r.schedule.predicted_next_date.toMillis() : null,
          r.schedule.average_amount,
          deps.span_start_ms,
          deps.span_end_ms
        );
      } else {
        // Bills: generate expected occurrences from the schedule, then reconcile.
        const expected: ExpectedOccurrence[] = generate_expected_occurrences_in_window(
          r.schedule,
          deps.span_start_ms,
          deps.span_end_ms
        ).map((g) => ({
          occurrence_id: `${r.id}_${g.due_date_ms}`,
          recurring_id: r.id,
          due_date_ms: g.due_date_ms,
          amount_due: g.amount_due,
        }));
        reconciled = reconcile_occurrences(expected, r.payments);
      }
      const groups = place_occurrences(reconciled, deps.placement_buckets);
      (r.kind === "outflow" ? bills : income).push({ recurring_id: r.id, name: r.name, groups });
    }

    if (is_budget_exceeded(perf, BUDGET)) {
      console.warn(`[${ctx.trace_id}] Performance budget exceeded for derive_period`);
    }
    log_operation_success(span, user_id);
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "derive_period",
        status: "success",
        output: {
          view_cadence: input.view_cadence,
          budgets: budgets.length,
          bills: bills.length,
          income: income.length,
          splits: deps.splits_for_match.length,
        },
      })
    );

    return { view_cadence: input.view_cadence, budgets, bills, income };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "DERIVE_PERIOD_FAILED" }
    );
    throw error;
  }
}
