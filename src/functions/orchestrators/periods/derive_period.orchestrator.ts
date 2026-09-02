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
import {
  generate_expected_occurrences_in_window,
} from "../../domain/outflows/outflow_period.service";
import { estimate_slot_amounts } from "../../domain/recurring/income_slot_amounts";
import {
  reconcile_occurrences,
  reconcile_income_occurrences,
  ExpectedOccurrence,
} from "../../domain/recurring/reconcile_occurrences.service";
import {
  place_occurrences,
  PlacedOccurrenceGroup,
} from "../../domain/recurring/occurrence_placement.service";
import {
  is_suppressed_in_period,
} from "../../domain/recurring/recurring_suppression.service";
import { PeriodInstanceType } from "../../domain/budgets";

const BUDGET: PerformanceBudget = { max_reads: 200, max_writes: 0, max_time_ms: 1500 };

/** Synthetic income id for the "Other Income" bucket (unmatched real INCOME_* credits). */
const OTHER_INCOME_ID = "__other_income__";

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
    // Period end (ms) per bucket → drop occurrence-groups in a suppressed period
    // (user remove/pause), snapping to whole periods per the viewing cadence.
    const period_end_by_id = new Map(
      deps.placement_buckets.map((b) => [b.period_id, b.end_ms])
    );
    const bills: DerivedRecurringResult[] = [];
    const income: DerivedRecurringResult[] = [];
    for (const r of deps.recurring) {
      // Both bills AND income generate EXPECTED occurrences from the schedule (freq +
      // anchor) across the window — so a semi-monthly item yields 2/month and future
      // months still show upcoming occurrences (income no longer projects just one).
      let expected: ExpectedOccurrence[] = generate_expected_occurrences_in_window(
        r.schedule,
        deps.span_start_ms,
        deps.span_end_ms
      ).map((g) => ({
        occurrence_id: `${r.id}_${g.due_date_ms}`,
        recurring_id: r.id,
        due_date_ms: g.due_date_ms,
        amount_due: g.amount_due,
      }));
      // INCOME per-slot amounts: give each occurrence its OWN slot's recent-average amount
      // (mid-month vs end-of-month) from history, instead of the single blended stream average.
      // Received occurrences still use the ACTUAL deposit (in reconcile); this sets the amount
      // shown for OUTSTANDING occurrences.
      if (r.kind === "inflow" && (r.payment_history?.length ?? 0) > 0) {
        const occ_days = expected.map((e) => new Date(e.due_date_ms).getUTCDate());
        const slot_amounts = estimate_slot_amounts(occ_days, r.payment_history!);
        if (slot_amounts.size > 0) {
          expected = expected.map((e) => {
            const day = new Date(e.due_date_ms).getUTCDate();
            const amt = slot_amounts.get(day);
            return amt != null ? { ...e, amount_due: amt } : e;
          });
        }
      }
      // Income reconciles those expected occurrences against ACTUAL Plaid deposits
      // (authoritative receipts, with extras surfaced); bills reconcile against linked
      // payments. Both then place into the view buckets identically.
      const reconciled =
        r.kind === "inflow"
          ? reconcile_income_occurrences(
            r.id,
            r.payments,
            expected,
            deps.span_start_ms,
            deps.span_end_ms
          )
          : reconcile_occurrences(expected, r.payments);
      const groups = place_occurrences(reconciled, deps.placement_buckets);
      // Suppress groups whose period is removed/paused for this item (per-period snap).
      const visible_groups = groups.filter((g) => {
        const end_ms = period_end_by_id.get(g.period_id);
        return end_ms === undefined || !is_suppressed_in_period(r.removal_intervals, end_ms);
      });
      (r.kind === "outflow" ? bills : income).push({
        recurring_id: r.id,
        name: r.name,
        groups: visible_groups,
      });
    }

    // "Other income received": real INCOME_* credits in the window not tied to any recurring
    // inflow (off-cycle paychecks, bonuses, contractor/gig). Surface them as a synthetic
    // "Other Income" bucket — each a RECEIVED occurrence with its actual amount — so real
    // income is never hidden just because Plaid didn't group it into a recurring stream.
    if (deps.other_income_credits.length > 0) {
      const other_occurrences = deps.other_income_credits.map((c, i) => ({
        occurrence_id: `other_income_${c.date_ms}_${i}`,
        recurring_id: OTHER_INCOME_ID,
        due_date_ms: c.date_ms,
        amount_due: c.amount,
        amount_paid: c.amount,
        is_paid: true,
      }));
      const other_groups = place_occurrences(other_occurrences, deps.placement_buckets);
      if (other_groups.some((g) => g.is_due_period)) {
        income.push({ recurring_id: OTHER_INCOME_ID, name: "Other Income", groups: other_groups });
      }
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
