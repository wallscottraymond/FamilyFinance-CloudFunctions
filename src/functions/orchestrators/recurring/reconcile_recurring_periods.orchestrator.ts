/**
 * Reconcile Recurring Periods Orchestrator
 * (Recurring-Period-Reconciliation Phase 3e — the `reconcile_recurring_period` job body)
 *
 * Recomputes a recurring doc's period paid/received status from its currently-
 * linked splits, invalidation-style: resolve → align (domain) → compute (domain)
 * → write (repo). Idempotent — every run recomputes from the live links, so
 * removing/un-matching a split naturally reverts a period's status.
 *
 * @module orchestrators/recurring/reconcile_recurring_periods
 */

import { TraceContext, create_performance_metrics } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import {
  resolve_recurring_reconciliation,
  RecurringType,
} from "../../resolvers/recurring/period_reconciliation.resolver";
import {
  align_transaction_to_period,
  compute_period_reconciliation,
  default_tolerance_ms,
  default_early_window_ms,
  LinkedSplit,
  PeriodForAlignment,
  ReconciliationResult,
} from "../../domain/recurring/period_reconciliation.service";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import { inflow_period_repo } from "../../repositories/inflow_period.repo";

export interface ReconcileRecurringPeriodInput {
  recurring_id: string;
  recurring_type: RecurringType;
  user_id: string;
  trace_id: string;
}

export interface ReconcileRecurringPeriodResult {
  periods_reconciled: number;
  success: boolean;
}

export async function reconcile_recurring_periods_orchestrator(
  ctx: TraceContext,
  input: ReconcileRecurringPeriodInput
): Promise<ReconcileRecurringPeriodResult> {
  const span = create_span(ctx, "orchestrator", "reconcile_recurring_periods");
  const perf = create_performance_metrics();
  log_operation_start(span, input.user_id);

  try {
    // 1. Resolve: active periods + sign-normalized linked splits.
    const resolved = await resolve_recurring_reconciliation(ctx, {
      recurring_id: input.recurring_id,
      recurring_type: input.recurring_type,
    });
    perf.reads++;

    if (resolved.periods.length === 0) {
      log_operation_success(span, input.user_id);
      return { periods_reconciled: 0, success: true };
    }

    // 2. A recurring doc generates periods of MULTIPLE types (monthly / weekly /
    //    bi_monthly) that overlap in time. A payment must reconcile ONE period
    //    PER TYPE — so it shows paid/received in every period-type view (mirrors
    //    budget spend across overlapping periods). Group by type, align within each.
    const periods_by_type = new Map<string, typeof resolved.periods>();
    for (const p of resolved.periods) {
      const arr = periods_by_type.get(p.period_type) ?? [];
      arr.push(p);
      periods_by_type.set(p.period_type, arr);
    }

    const by_period = new Map<string, LinkedSplit[]>();
    for (const type_periods of periods_by_type.values()) {
      // Tolerance scales with THIS type's period length.
      const sample_len = type_periods[0].end_ms - type_periods[0].start_ms;
      const opts = {
        tolerance_ms: default_tolerance_ms(0, sample_len),
        early_window_ms: default_early_window_ms(0, sample_len),
      };
      const align_periods: PeriodForAlignment[] = type_periods.map((p) => ({
        period_id: p.period_id,
        start_ms: p.start_ms,
        end_ms: p.end_ms,
        due_date_ms: p.due_date_ms,
      }));
      for (const s of resolved.splits) {
        const aligned = align_transaction_to_period(s.date_ms, align_periods, opts);
        if (!aligned.period_id) continue;
        const arr = by_period.get(aligned.period_id) ?? [];
        arr.push({
          transaction_id: s.transaction_id,
          split_id: s.split_id,
          amount: s.amount,
          is_pending: s.is_pending,
          date_ms: s.date_ms,
        });
        by_period.set(aligned.period_id, arr);
      }
    }

    // 3. Compute status for EVERY active period (periods that lost their split
    //    recompute to `none` — un-match reverts for free).
    const results: ReconciliationResult[] = resolved.periods.map((p) =>
      compute_period_reconciliation(
        {
          period_id: p.period_id,
          start_ms: p.start_ms,
          end_ms: p.end_ms,
          is_variable_amount: p.is_variable_amount,
          amount_per_occurrence: p.amount_per_occurrence,
          occurrence_due_dates_ms: p.occurrence_due_dates_ms,
        },
        by_period.get(p.period_id) ?? []
      )
    );

    // 4. Write (repo skips nothing — resolver already loaded active-only).
    const writes =
      input.recurring_type === "outflow"
        ? await outflow_period_repo.update_reconciliation(ctx, results)
        : await inflow_period_repo.update_reconciliation(ctx, results);
    perf.writes += writes.length;

    log_operation_success(span, input.user_id);

    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "reconcile_recurring_periods",
        status: "success",
        context: {
          recurring_id: input.recurring_id,
          recurring_type: input.recurring_type,
          active_periods: resolved.periods.length,
          linked_splits: resolved.splits.length,
          periods_reconciled: results.length,
          perf_reads: perf.reads,
          perf_writes: perf.writes,
        },
      })
    );

    console.log(
      `[${ctx.trace_id}] reconcile_recurring_periods: ${input.recurring_type}=${input.recurring_id}, ` +
        `periods=${results.length}, splits=${resolved.splits.length}`
    );

    return { periods_reconciled: results.length, success: true };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "RECONCILE_RECURRING_PERIODS_FAILED" }
    );
    throw error;
  }
}
