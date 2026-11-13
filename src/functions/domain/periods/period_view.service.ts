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
import { compute_budget_spent } from "../budgets/budget_spend.service";
import { fund_position } from "../budgets/fund.service";
import {
  compute_ee_leftovers,
  EELeftoverBucketInputs,
} from "../budgets/everything_else_leftover.service";
import { generate_expected_occurrences_in_window } from "../outflows/outflow_period.service";
import type { ActualPayment } from "../recurring/reconcile_occurrences.service";
import {
  reconcile_occurrences,
  reconcile_income_occurrences,
} from "../recurring/reconcile_occurrences.service";
import {
  build_expected_occurrences,
  make_income_expected_parts,
  uses_income_parts,
  income_check_dates,
} from "../recurring/expected_occurrences.service";
import {
  PartStat,
  compute_part_stats,
  make_is_last_of_month,
  received_check_parts,
  fixed_total_check_parts,
  sum_sure_parts,
  sum_parts,
} from "../recurring/income_parts.service";
import { occurrence_date_key } from "../recurring/manual_settlement.service";
import { apply_manual_settlements } from "../recurring/manual_settlement.service";
import {
  place_occurrences,
  PlacedOccurrenceGroup,
} from "../recurring/occurrence_placement.service";
import {
  EARLY_CARRY_MAX_MS,
  carried_early_payment_ms,
  is_payment_suppressed,
  paused_until_for_due,
  is_suppressed_in_period,
} from "../recurring/recurring_suppression.service";
import type { ReconciledOccurrence } from "../recurring/reconcile_occurrences.service";
import { PeriodDerivationDeps } from "./period_derivation.types";

/** Synthetic income id for the "Other Income" bucket (unmatched real INCOME_* credits). */
export const OTHER_INCOME_ID = "__other_income__";

export interface DerivedBudgetResult {
  budget_id: string;
  name: string;
  is_everything_else: boolean;
  is_fund?: boolean;
  /** The budget's user-facing first_category slugs (canon C3/A2); [] for Everything Else and
   *  manual budgets. */
  first_category_ids: string[];
  periods: DerivedBudgetViewPeriod[];
}
export interface DerivedRecurringResult {
  recurring_id: string;
  name: string;
  groups: PlacedOccurrenceGroup[];
  /** Group views only (see RecurringForDerivation.owner_user_id). */
  owner_user_id?: string;
  /** Income with parts only: each part's avg / typical / careful amount. */
  part_stats?: PartStat[];
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
        deps.splits_for_match,
        deps.ee_alias_ids
      );
      const periods = derive_budget_view_periods(
        b.id,
        deps.view_buckets,
        b.monthly_periods,
        owned,
        b.active_start_ms,
        b.active_end_ms,
        b.priced,
        b.paused_ranges
      );
      if (b.fund_total !== undefined) {
        const total = b.fund_total;
        // The same owner rule as the period's own spend, over the fund's earlier transactions too.
        const earlier = owned_splits_for_budget(
          b.id,
          deps.real_budgets,
          ee_id,
          (deps.fund_prior_splits ?? []).filter((s) => s.txn_date_ms < deps.span_start_ms),
          deps.ee_alias_ids
        );
        const to_date = [...earlier, ...owned.filter((s) => s.txn_date_ms >= deps.span_start_ms)];
        const fund_periods = periods.map((p) => {
          const spent = compute_budget_spent(b.id, 0, p.end_ms, to_date).spent;
          const position = fund_position(total, spent);
          return { ...p, remaining: position.left, fund_total: total, fund_spent_to_date: position.spent_to_date };
        });
        return {
          budget_id: b.id, name: b.name, is_everything_else: false, is_fund: true,
          first_category_ids: b.first_category_ids ?? [], periods: fund_periods,
        };
      }
      return {
        budget_id: b.id, name: b.name, is_everything_else: b.is_ee,
        first_category_ids: b.first_category_ids ?? [], periods,
      };
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
    // Expected occurrences (due date + the amount the page expects) — the shared rule.
    // D28: a removed / paused / ended BILL also looks just past the span, so an occurrence due in
    // a suppressed month right after it can be matched by an early payment made inside the span
    // (due Oct 1, paid Sep 29: the Sep view). Only such carried occurrences are kept from there.
    const lookahead_ms = r.kind === "outflow" && r.removal_intervals?.length ? EARLY_CARRY_MAX_MS : 0;
    const expected = build_expected_occurrences(r, deps.span_start_ms, deps.span_end_ms + lookahead_ms)
      // Past the span: only a suppressed month's occurrence (the only kind an early payment carries
      // back) — a kept one there could take a payment from an occurrence inside the span.
      .filter((e) => e.due_date_ms <= deps.span_end_ms || is_payment_suppressed(r.removal_intervals, e.due_date_ms));
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
        : reconcile_occurrences(
          expected,
          resolve_pinned_payments(r.payments, r.schedule, deps.span_start_ms, deps.span_end_ms)
        );
    // "Mark as paid / received": an occurrence no real payment settled but the user marked is
    // settled manually (the ONE rule stored reconcile applies too — never double-counted).
    const settled = apply_manual_settlements(reconciled, r.manual_settled_occurrences);
    // Removed / paused / ended spans: an occurrence is dropped when its (UTC) MONTH is suppressed
    // — the same month snap the engine and stored reconcile use to release a payment
    // (is_payment_suppressed). Judging by the VIEW period's end instead dropped a week (or any
    // bucket) straddling the boundary in full: a payment made before an "It ended" date then
    // counted nowhere (not paid, not released). Monthly views are unchanged (bucket = month).
    // D28: an occurrence of a suppressed month paid EARLY from a month that isn't suppressed
    // counts as paid at its payment date (the month it was made), so that payment is counted once.
    const kept = r.removal_intervals?.length
      ? keep_unsuppressed(settled, r.removal_intervals, deps.span_start_ms, deps.span_end_ms)
      : settled;
    // Income with parts: attach each check's breakdown (received = the deposit split; outstanding
    // = the planned parts). Incomes without parts skip this entirely (output unchanged).
    const parts_on = uses_income_parts(r);
    const placed_input = parts_on ? attach_income_parts(r, kept, deps.span_start_ms, deps.span_end_ms) : kept;
    const groups = place_occurrences(placed_input, deps.placement_buckets);
    // A suppressed period shows the item only for the occurrences it kept (none → hidden).
    // A PAUSED one stays listed at $0, marked, with its resume date, in the periods it would have
    // been due: pausing a monthly bill must not add it to the other weeks of a weekly view (AF-03).
    const paused_until_by_period = new Map<string, number>();
    if (r.removal_intervals?.length) {
      for (const g of place_occurrences(settled, deps.placement_buckets)) {
        for (const o of g.occurrences) {
          const until = paused_until_for_due(r.removal_intervals, o.due_ms);
          if (until !== null) paused_until_by_period.set(g.period_id, until);
        }
      }
    }
    const visible_groups = groups.flatMap((g) => {
      if (g.count_in_period > 0) return [g];
      const paused_until_ms = paused_until_by_period.get(g.period_id);
      if (paused_until_ms !== undefined) return [{ ...g, paused_until_ms }];
      const end_ms = period_end_by_id.get(g.period_id);
      return end_ms === undefined || !is_suppressed_in_period(r.removal_intervals, end_ms) ? [g] : [];
    });
    (r.kind === "outflow" ? bills : income).push({
      recurring_id: r.id,
      name: r.name,
      groups: visible_groups,
      ...(r.owner_user_id ? { owner_user_id: r.owner_user_id } : {}),
      ...(parts_on
        ? {
          part_stats: compute_part_stats({
            parts: r.income_parts ?? [],
            settings: r.forecast_settings,
            deposits: r.payment_history ?? [],
            occurrence_parts: r.occurrence_parts,
            check_dates: (from, to) =>
              generate_expected_occurrences_in_window(r.schedule, from, to).map((g) => g.due_date_ms),
          }),
        }
        : {}),
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

/**
 * Income with parts: put each check's breakdown on its occurrence. A received check splits the
 * actual deposit (labelled split, else the default rule); an outstanding one shows the planned
 * parts (a legacy per-check amount override has no parts: its amount stands alone). PURE.
 */
export function attach_income_parts(
  r: PeriodDerivationDeps["recurring"][number],
  occurrences: ReconciledOccurrence[],
  span_start_ms: number,
  span_end_ms: number
): ReconciledOccurrence[] {
  const is_last = make_is_last_of_month([
    ...income_check_dates(r, span_start_ms, span_end_ms),
    ...occurrences.map((o) => o.due_date_ms),
  ]);
  const planned = make_income_expected_parts(r, span_start_ms, span_end_ms, occurrences.map((o) => o.due_date_ms));
  return occurrences.map((o) => {
    if (o.is_paid) {
      const parts = received_check_parts({
        parts: r.income_parts ?? [],
        occurrence_parts: r.occurrence_parts,
        amount: o.amount_paid,
        date_ms: o.due_date_ms,
        is_last_of_month: is_last(o.due_date_ms),
      });
      return { ...o, parts, sure_amount: sum_parts(parts) };
    }
    // An amount set on this one check before it had parts: keep that total, label its parts.
    const set_total = r.occurrence_amount_overrides?.[occurrence_date_key(o.due_date_ms)];
    if (set_total != null) {
      const parts = fixed_total_check_parts({
        parts: r.income_parts ?? [],
        occurrence_parts: r.occurrence_parts,
        amount: set_total,
        date_ms: o.due_date_ms,
        is_last_of_month: is_last(o.due_date_ms),
      });
      return { ...o, parts, sure_amount: sum_parts(parts) };
    }
    const parts = planned(o.due_date_ms);
    return { ...o, parts, sure_amount: sum_sure_parts(parts) };
  });
}

/**
 * The occurrences a removed / paused / ended item keeps (D26 month rule + D28): an occurrence due
 * in a month that isn't suppressed is kept (only inside the span — the D28 look-ahead adds
 * nothing else); one due in a suppressed month is dropped, unless it was paid EARLY by a payment
 * made in a month that isn't suppressed — then it is kept, dated at that payment (so it lands in
 * the payment's bucket), when the payment is inside the span. PURE.
 */
export function keep_unsuppressed(
  occurrences: ReconciledOccurrence[],
  intervals: Parameters<typeof is_payment_suppressed>[0],
  span_start_ms: number,
  span_end_ms: number
): ReconciledOccurrence[] {
  const out: ReconciledOccurrence[] = [];
  for (const o of occurrences) {
    if (!is_payment_suppressed(intervals, o.due_date_ms)) {
      if (o.due_date_ms <= span_end_ms) out.push(o);
      continue;
    }
    const carried = o.is_paid && !o.is_manual
      ? carried_early_payment_ms(intervals, o.due_date_ms, o.payment_date_ms)
      : null;
    if (carried !== null && carried >= span_start_ms && carried <= span_end_ms) {
      out.push({ ...o, due_date_ms: carried });
    }
  }
  return out;
}

/**
 * A bill payment the user PINNED to a period pays THAT period's FIRST due occurrence (from the
 * bill's schedule) — exactly the occurrence stored reconcile places it on (its due date), in every
 * period type. Here it settles only that occurrence, and only in the span containing its due date
 * (so a weekly bill pinned to a month pays one week, and a range derive counts it once). A pinned
 * period with no occurrence: placed at its midpoint (matches nothing). Unpinned payments pass
 * through unchanged. PURE.
 */
export function resolve_pinned_payments(
  payments: ActualPayment[],
  schedule: Parameters<typeof generate_expected_occurrences_in_window>[0],
  span_start_ms: number,
  span_end_ms: number
): ActualPayment[] {
  const out: ActualPayment[] = [];
  for (const p of payments) {
    if (!p.pinned_window) {
      out.push(p);
      continue;
    }
    const { start_ms, end_ms } = p.pinned_window;
    const first = generate_expected_occurrences_in_window(schedule, start_ms, end_ms)
      .map((g) => g.due_date_ms)
      .filter((ms) => ms >= start_ms && ms <= end_ms)
      .sort((a, b) => a - b)[0];
    const due = first ?? Math.floor((start_ms + end_ms) / 2);
    if (due < span_start_ms || due > span_end_ms) continue; // pays another span's occurrence
    out.push({ ...p, date_ms: due, pinned_window: { start_ms: due, end_ms: due } });
  }
  return out;
}

