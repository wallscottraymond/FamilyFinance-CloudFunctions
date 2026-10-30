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
import { RecurringScheduleForGeneration } from "../outflows/outflow_period.service";
import { DepositForSlot } from "./income_slot_amounts";
import type { ExpectedOccurrence } from "./reconcile_occurrences.service";
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
export declare function build_expected_occurrences(r: RecurringForExpected, span_start_ms: number, span_end_ms: number): ExpectedOccurrence[];
//# sourceMappingURL=expected_occurrences.service.d.ts.map