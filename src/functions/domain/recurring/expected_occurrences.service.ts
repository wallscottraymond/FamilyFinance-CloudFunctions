/**
 * Expected Occurrences Domain Service
 *
 * THE expected occurrences (due date + expected amount) of a bill / income over a span — exactly
 * what the period page shows for an outstanding occurrence. Shared by the period page
 * (`compute_period_view`) and "Mark as paid / received" (which settles an occurrence at the
 * amount the page expects), so both read one rule:
 *
 *   per-occurrence override (income) > per-slot history estimate (income, no definition
 *   override) > definition override (`expectedAmountOverride`, already in `schedule`) > average.
 *
 * PURE: no IO.
 *
 * @module domain/recurring/expected_occurrences
 */

import {
  generate_expected_occurrences_in_window,
  RecurringScheduleForGeneration,
} from "../outflows/outflow_period.service";
import { estimate_slot_amounts, DepositForSlot } from "./income_slot_amounts";
import type { ExpectedOccurrence } from "./reconcile_occurrences.service";
import { occurrence_date_key } from "./manual_settlement.service";
import {
  ForecastSettings,
  IncomePart,
  OccurrencePartsMap,
  CheckPart,
  make_expected_parts_calculator,
  make_is_last_of_month,
  sum_parts,
} from "./income_parts.service";

/** The item fields the expected-amount rule reads (a `RecurringForDerivation` fits). */
export interface RecurringForExpected {
  id: string;
  kind: "outflow" | "inflow";
  /** `average_amount` here is already `expectedAmountOverride ?? averageAmount`. */
  schedule: RecurringScheduleForGeneration;
  /** INCOME only: true when the user set a definition-level expected override. */
  has_amount_override?: boolean;
  /** INCOME only: the stream's historical deposits (per-slot estimate). */
  payment_history?: DepositForSlot[];
  /** INCOME only: per-occurrence expected overrides keyed by UTC due date `YYYY-MM-DD`. */
  occurrence_amount_overrides?: Record<string, number>;
  /** INCOME only: the check is made of parts (Income-Detail-Screen). Non-empty → parts rule. */
  income_parts?: IncomePart[];
  forecast_settings?: ForecastSettings;
  /** Per-check part overrides + one-off extras, keyed by UTC due date `YYYY-MM-DD`. */
  occurrence_parts?: OccurrencePartsMap;
  /** INCOME only: "As it comes" — no planned checks; its deposits are what it received. */
  as_it_comes?: boolean;
}

/** True when the income's amounts come from its parts. */
export function uses_income_parts(r: Pick<RecurringForExpected, "kind" | "income_parts">): boolean {
  return r.kind === "inflow" && (r.income_parts?.length ?? 0) > 0;
}

/** Every check date of the income's UTC months touching the span (so "last check of the month"
 *  is right even when the span ends mid-month). */
export function income_check_dates(r: RecurringForExpected, span_start_ms: number, span_end_ms: number): number[] {
  const s = new Date(span_start_ms);
  const e = new Date(span_end_ms);
  const from = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1);
  const to = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0, 23, 59, 59, 999);
  return generate_expected_occurrences_in_window(r.schedule, from, to).map((g) => g.due_date_ms);
}

/**
 * The calculator for an income's EXPECTED parts of an outstanding check (one rule, shared by the
 * amount in `build_expected_occurrences` and the breakdown the period page returns).
 */
export function make_income_expected_parts(
  r: RecurringForExpected,
  span_start_ms: number,
  span_end_ms: number,
  extra_dates_ms: number[] = []
): (due_ms: number) => CheckPart[] {
  const is_last = make_is_last_of_month([...income_check_dates(r, span_start_ms, span_end_ms), ...extra_dates_ms]);
  return make_expected_parts_calculator(
    {
      parts: r.income_parts ?? [],
      settings: r.forecast_settings,
      deposits: r.payment_history ?? [],
      occurrence_parts: r.occurrence_parts,
      check_dates: (from, to) => generate_expected_occurrences_in_window(r.schedule, from, to).map((g) => g.due_date_ms),
    },
    is_last
  );
}

export function build_expected_occurrences(
  r: RecurringForExpected,
  span_start_ms: number,
  span_end_ms: number
): ExpectedOccurrence[] {
  // "As it comes" income plans nothing: every deposit labelled with it reconciles as an extra
  // (received) occurrence, so it shows exactly what arrived (D24).
  if (r.kind === "inflow" && r.as_it_comes) return [];
  // Both bills AND income generate EXPECTED occurrences from the schedule (freq + anchor)
  // across the span — so a semi-monthly item yields 2/month and future months still show
  // upcoming occurrences.
  let expected: ExpectedOccurrence[] = generate_expected_occurrences_in_window(
    r.schedule,
    span_start_ms,
    span_end_ms
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
  // Parts (when the income has them) replace the amount here; legacy per-check overrides still win below.
  if (uses_income_parts(r)) {
    const parts_for = make_income_expected_parts(r, span_start_ms, span_end_ms);
    expected = expected.map((e) => ({ ...e, amount_due: sum_parts(parts_for(e.due_date_ms)) }));
  } else if (r.kind === "inflow" && !r.has_amount_override && (r.payment_history?.length ?? 0) > 0) {
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
  // actual deposit via reconcile. Lets the user edit one check at a time (e.g. just the
  // Sep 30 commission) without moving the others.
  const occ_overrides = r.occurrence_amount_overrides;
  if (r.kind === "inflow" && occ_overrides && Object.keys(occ_overrides).length > 0) {
    expected = expected.map((e) => {
      const amt = occ_overrides[occurrence_date_key(e.due_date_ms)];
      return amt != null ? { ...e, amount_due: amt } : e;
    });
  }
  return expected;
}
