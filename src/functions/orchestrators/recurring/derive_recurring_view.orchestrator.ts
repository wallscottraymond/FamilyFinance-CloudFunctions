/**
 * Derive Recurring View Orchestrator
 *
 * Read-only coordination for the Derive-On-Read Period Architecture (Phase 3):
 * derive a bill/income (recurring outflow) view for a bounded window by running
 * the pure pipeline — generate expected occurrences FRESH from the schedule →
 * reconcile against actual payments → place into the viewed cadence's buckets.
 * Nothing is stored, so nothing can go stale.
 *
 * @module orchestrators/recurring/derive_recurring_view
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
import {
  resolve_recurring_view_deps,
  RecurringKind,
} from "../../resolvers/recurring/recurring_view.resolver";
import { generate_expected_occurrences_in_window } from "../../domain/outflows/outflow_period.service";
import {
  reconcile_occurrences,
  ExpectedOccurrence,
} from "../../domain/recurring/reconcile_occurrences.service";
import {
  place_occurrences,
  PlacedOccurrenceGroup,
} from "../../domain/recurring/occurrence_placement.service";
import { PeriodInstanceType } from "../../domain/budgets";

const BUDGET: PerformanceBudget = {
  max_reads: 60,
  max_writes: 0,
  max_time_ms: 500,
};

export interface DeriveRecurringViewInput {
  kind: RecurringKind;
  recurring_id: string;
  view_cadence: PeriodInstanceType;
  window_start_ms: number;
  window_end_ms: number;
}

export interface DeriveRecurringViewResult {
  kind: RecurringKind;
  recurring_id: string;
  name: string;
  view_cadence: PeriodInstanceType;
  groups: PlacedOccurrenceGroup[];
}

/**
 * Derive a recurring item's view for a window. Returns `null` when the outflow
 * doesn't exist or isn't owned by the caller (entry maps that to not-found).
 */
export async function derive_recurring_view_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: DeriveRecurringViewInput
): Promise<DeriveRecurringViewResult | null> {
  const span = create_span(ctx, "orchestrator", "derive_recurring_view");
  const perf = create_performance_metrics();
  log_operation_start(span, user_id);

  try {
    // 1. Gather deps (schedule + buckets + payments), bounded to the window.
    const deps = await resolve_recurring_view_deps(
      ctx,
      user_id,
      input.kind,
      input.recurring_id,
      input.view_cadence,
      input.window_start_ms,
      input.window_end_ms
    );
    perf.reads += 3;
    if (!deps) {
      return null;
    }

    // 2. Pure pipeline: generate FRESH → reconcile → place.
    const expected: ExpectedOccurrence[] = generate_expected_occurrences_in_window(
      deps.schedule,
      deps.span_start_ms,
      deps.span_end_ms
    ).map((g) => ({
      occurrence_id: `${input.recurring_id}_${g.due_date_ms}`,
      recurring_id: input.recurring_id,
      due_date_ms: g.due_date_ms,
      amount_due: g.amount_due,
    }));

    const reconciled = reconcile_occurrences(expected, deps.payments);
    const groups = place_occurrences(reconciled, deps.buckets);

    if (is_budget_exceeded(perf, BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] Performance budget exceeded for derive_recurring_view`
      );
    }

    log_operation_success(span, user_id);

    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "derive_recurring_view",
        status: "success",
        output: {
          view_cadence: input.view_cadence,
          bucket_count: deps.buckets.length,
          expected_count: expected.length,
          payment_count: deps.payments.length,
        },
      })
    );

    return {
      kind: input.kind,
      recurring_id: input.recurring_id,
      name: deps.name,
      view_cadence: input.view_cadence,
      groups,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "DERIVE_RECURRING_VIEW_FAILED" }
    );
    throw error;
  }
}
