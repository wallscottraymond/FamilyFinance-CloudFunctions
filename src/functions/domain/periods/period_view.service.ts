/**
 * Period View Service (pure)
 *
 * Derives a WHOLE period view — budgets (on-read matched), bills, income (generate → reconcile →
 * place), the synthetic "Other Income" bucket, and the Everything-Else leftover — from one
 * window's resolved inputs. Pure + deterministic: no IO, no clock. Shared by `derive_period`
 * (one window) and `derive_period_range` (many windows from one load), so every window's result
 * is computed by exactly the same code.
 *
 * @module domain/periods/period_view.service
 */

import { PeriodInstanceType } from "../budgets";
import {
  derive_budget_view_periods,
  DerivedBudgetViewPeriod,
} from "../budgets/budget_view.service";
import { owned_splits_for_budget } from "../budgets/budget_spend_match.service";
import {
  compute_ee_leftovers,
  EELeftoverBucketInputs,
} from "../budgets/everything_else_leftover.service";
import { generate_expected_occurrences_in_window } from "../outflows/outflow_period.service";
import { estimate_slot_amounts } from "../recurring/income_slot_amounts";
import {
  reconcile_occurrences,
  reconcile_income_occurrences,
  ExpectedOccurrence,
} from "../recurring/reconcile_occurrences.service";
import {
  place_occurrences,
  PlacedOccurrenceGroup,
} from "../recurring/occurrence_placement.service";
import { is_suppressed_in_period } from "../recurring/recurring_suppression.service";
import { PeriodDerivationDeps } from "./period_derivation.types";

/** Synthetic income id for the "Other Income" bucket (unmatched real INCOME_* credits). */
export const OTHER_INCOME_ID = "__other_income__";

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

export function compute_period_view(
  deps: PeriodDerivationDeps,
  view_cadence: PeriodInstanceType
): DerivePeriodResult {
  // Budgets — on-read match + derive (all from the shared splits, in memory).
  const budgets: DerivedBudgetResult[] = deps.budgets
    .map((b) => {
      const ee_id = b.is_ee ? b.id : deps.monthly_ee_id ?? deps.any_ee_id;
      const owned = owned_splits_for_budget(
        b.id,
        deps.real_budgets,
        ee_id,
        deps.splits_for_match
      );
      const periods = derive_budget_view_periods(
        b.id,
        deps.view_buckets,
        b.monthly_periods,
        owned,
        b.active_start_ms,
        b.active_end_ms
      );
      return { budget_id: b.id, name: b.name, is_everything_else: b.is_ee, periods };
    })
    // A budget with NO periods in this view is entirely outside its active range (e.g. a newly
    // created budget viewed in a past period) — omit it so no empty $0 card is surfaced. EE is
    // active from epoch, so it always has periods and is never dropped.
    .filter((b) => b.periods.length > 0);

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
    // SKIP when the user set an explicit expected-amount override ("this + future") — an
    // explicit override MUST win over the auto slot-estimate, otherwise editing the expected
    // does nothing for multi-occurrence income (its amount_due already carries the override).
    if (r.kind === "inflow" && !r.has_amount_override && (r.payment_history?.length ?? 0) > 0) {
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
    // Per-occurrence MANUAL override wins over everything (slot estimate + definition
    // override): if the user set an amount for a specific occurrence — keyed by its UTC
    // due-date `YYYY-MM-DD` — use it. Outstanding occurrences only; received ones show the
    // actual deposit via reconcile below. Lets the user edit one check at a time (e.g. just
    // the Sep 30 commission) without moving the others.
    const occ_overrides = r.occurrence_amount_overrides;
    if (r.kind === "inflow" && occ_overrides && Object.keys(occ_overrides).length > 0) {
      expected = expected.map((e) => {
        const key = new Date(e.due_date_ms).toISOString().slice(0, 10);
        const amt = occ_overrides[key];
        return amt != null ? { ...e, amount_due: amt } : e;
      });
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

  // Everything-Else LEFTOVER: EE's limit = expected income − bills due − goal
  // set-aside − Σ other budgets' allocated, per view bucket (zero-based remainder).
  // All inputs are already computed per bucket above; override the canonical EE.
  const canonical_ee_id = deps.monthly_ee_id ?? deps.any_ee_id;
  const ee_budget = budgets.find(
    (b) => b.is_everything_else && b.budget_id === canonical_ee_id
  );
  if (ee_budget) {
    const sum_due_by_period = (
      results: DerivedRecurringResult[],
      skip_id?: string
    ): Map<string, number> => {
      const m = new Map<string, number>();
      for (const r of results) {
        if (skip_id && r.recurring_id === skip_id) continue;
        for (const g of r.groups) {
          m.set(g.period_id, (m.get(g.period_id) ?? 0) + g.total_due);
        }
      }
      return m;
    };
    // Expected income = recurring streams only (exclude surprise "Other Income"
    // so the leftover stays stable — locked "expected, not received" decision).
    const income_by_period = sum_due_by_period(income, OTHER_INCOME_ID);
    const bills_by_period = sum_due_by_period(bills);
    const budgets_alloc_by_period = new Map<string, number>();
    for (const b of budgets) {
      if (b.is_everything_else) continue;
      for (const p of b.periods) {
        budgets_alloc_by_period.set(
          p.period_id,
          (budgets_alloc_by_period.get(p.period_id) ?? 0) + p.allocated_amount
        );
      }
    }
    const bucket_inputs: EELeftoverBucketInputs[] = deps.view_buckets.map((vb) => ({
      period_id: vb.period_id,
      start_ms: vb.start_ms,
      end_ms: vb.end_ms,
      expected_income: income_by_period.get(vb.period_id) ?? 0,
      bills_due: bills_by_period.get(vb.period_id) ?? 0,
      other_budgets_allocated: budgets_alloc_by_period.get(vb.period_id) ?? 0,
    }));
    const leftovers = compute_ee_leftovers(bucket_inputs, deps.goals);
    ee_budget.periods = ee_budget.periods.map((p) => {
      const lo = leftovers.get(p.period_id);
      if (!lo) return p;
      return {
        ...p,
        allocated_amount: lo.leftover,
        effective_amount: lo.leftover,
        remaining: Math.round((lo.leftover - p.spent + Number.EPSILON) * 100) / 100,
        no_income: !lo.has_income,
      };
    });
  }

  return { view_cadence, budgets, bills, income };
}
