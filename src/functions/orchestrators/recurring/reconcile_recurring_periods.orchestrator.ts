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

import { fingerprint_result } from "../../domain/recurring/reconciliation_fingerprint";
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
  carried_payments,
  compute_period_reconciliation,
  default_tolerance_ms,
  default_early_window_ms,
  LinkedSplit,
  PeriodForAlignment,
  ReconciliationResult,
} from "../../domain/recurring/period_reconciliation.service";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import { inflow_period_repo } from "../../repositories/inflow_period.repo";
import {
  is_stored_period_active,
  is_suppressed_in_period,
} from "../../domain/recurring/recurring_suppression.service";

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

    if (resolved.periods.length === 0 && (resolved.inactive_periods ?? []).length === 0) {
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
    const inactive_by_type = new Map<string, typeof resolved.periods>();
    for (const p of resolved.inactive_periods ?? []) {
      const arr = inactive_by_type.get(p.period_type) ?? [];
      arr.push(p);
      inactive_by_type.set(p.period_type, arr);
    }
    const intervals = resolved.removal_intervals;

    const by_period = new Map<string, LinkedSplit[]>();
    // D28: per period, the suppressed-month due dates an early payment carried in (moved to the
    // payment date), and the inactive periods that now hold one (turned on, marked carryActive).
    const carried_into = new Map<string, Array<{ due_ms: number; payment_ms: number }>>();
    const activate = new Map<string, (typeof resolved.periods)[number]>();
    for (const type of new Set([...periods_by_type.keys(), ...inactive_by_type.keys()])) {
      const type_periods = periods_by_type.get(type) ?? [];
      // Round 5 defect 5: an inactive period is turned on only when the removal is WHY it is off
      // (suppressed as a whole, no occurrence in a kept month) — one off for any other reason stays
      // off, and the payment is placed as any other.
      const off_by_id = new Map((inactive_by_type.get(type) ?? []).map((p) => [p.period_id, p]));
      // D31: a late payment goes to the (active) period holding the occurrence it pays.
      const carriable = (c: { period_id: string; late?: true }): boolean => {
        const off = off_by_id.get(c.period_id);
        if (c.late) return !off;
        return !off || (is_suppressed_in_period(intervals!, off.end_ms) &&
          !is_stored_period_active(intervals, off.end_ms, off.occurrence_due_dates_ms));
      };
      const carried = intervals?.length
        ? carried_payments([...type_periods, ...(inactive_by_type.get(type) ?? [])], resolved.splits, intervals)
          .filter(carriable)
        : [];
      const carried_idx = new Set(carried.map((c) => c.index));
      for (const c of carried) {
        const s = resolved.splits[c.index];
        const arr = by_period.get(c.period_id) ?? [];
        arr.push({ transaction_id: s.transaction_id, split_id: s.split_id, amount: s.amount, is_pending: s.is_pending, date_ms: s.date_ms });
        by_period.set(c.period_id, arr);
        if (c.late) continue; // D31: its occurrence keeps its due date (a kept month's)
        const list = carried_into.get(c.period_id) ?? [];
        list.push({ due_ms: c.carried_due_ms, payment_ms: s.date_ms });
        carried_into.set(c.period_id, list);
        const off = off_by_id.get(c.period_id);
        if (off) activate.set(off.period_id, off);
      }
      if (type_periods.length === 0) continue;
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
      for (const [i, s] of resolved.splits.entries()) {
        if (carried_idx.has(i)) continue; // D28: carried above
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
    const to_reconcile = [...resolved.periods, ...activate.values()];
    const results: ReconciliationResult[] = to_reconcile.map((p) =>
      compute_period_reconciliation(
        {
          period_id: p.period_id,
          start_ms: p.start_ms,
          end_ms: p.end_ms,
          is_variable_amount: p.is_variable_amount,
          amount_per_occurrence: p.amount_per_occurrence,
          // D28: a carried occurrence is expected at its payment's date (in this period).
          occurrence_due_dates_ms: with_carried(p.occurrence_due_dates_ms, carried_into.get(p.period_id)),
        },
        by_period.get(p.period_id) ?? [],
        // "Mark as paid / received": occurrences no real payment settled but the user marked.
        resolved.manual_marks
      )
    );

    // 4. Write only the periods whose result CHANGED (was: every active period, every time —
    //    hundreds of rewrites per stream per reconcile).
    const stored = new Map(to_reconcile.map((p) => [p.period_id, p.stored_fingerprint]));
    const changed = results.filter((r) => stored.get(r.period_id) !== fingerprint_result(r));
    const writes =
      input.recurring_type === "outflow"
        ? await outflow_period_repo.update_reconciliation(ctx, changed)
        : await inflow_period_repo.update_reconciliation(ctx, changed);
    perf.writes += writes.length;
    // D28: periods turned on by a carried payment; marked ones that no longer hold one turned off.
    // A marked period active again by the month rule itself (restored) only loses the mark.
    const released = resolved.periods.filter((p) => p.carry_active && !carried_into.has(p.period_id));
    const by_rule = (p: (typeof released)[number]) => is_stored_period_active(intervals, p.end_ms, p.occurrence_due_dates_ms);
    const carry_off = released.filter((p) => !by_rule(p)).map((p) => p.period_id);
    const carry_clear = released.filter(by_rule).map((p) => p.period_id);
    const carry_on = [...activate.keys()];
    if (carry_on.length + carry_off.length + carry_clear.length > 0) {
      perf.writes += input.recurring_type === "outflow"
        ? await outflow_period_repo.set_carry_active(ctx, carry_on, carry_off, carry_clear)
        : await inflow_period_repo.set_carry_active(ctx, carry_on, carry_off, carry_clear);
    }

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

/** D28: a period's due dates with each carried occurrence moved to its payment's date. PURE. */
function with_carried(due_ms: number[], carried: Array<{ due_ms: number; payment_ms: number }> | undefined): number[] {
  if (!carried?.length) return due_ms;
  const moved = new Set(carried.map((c) => c.due_ms));
  return [...due_ms.filter((d) => !moved.has(d)), ...carried.map((c) => c.payment_ms)];
}
