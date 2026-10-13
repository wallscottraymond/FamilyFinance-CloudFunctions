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
}

export function build_expected_occurrences(
  r: RecurringForExpected,
  span_start_ms: number,
  span_end_ms: number
): ExpectedOccurrence[] {
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
