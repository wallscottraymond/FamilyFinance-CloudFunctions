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
import { ForecastSettings, IncomePart, OccurrencePartsMap, CheckPart } from "./income_parts.service";
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
export declare function uses_income_parts(r: Pick<RecurringForExpected, "kind" | "income_parts">): boolean;
/** Every check date of the income's UTC months touching the span (so "last check of the month"
 *  is right even when the span ends mid-month). */
export declare function income_check_dates(r: RecurringForExpected, span_start_ms: number, span_end_ms: number): number[];
/**
 * The calculator for an income's EXPECTED parts of an outstanding check (one rule, shared by the
 * amount in `build_expected_occurrences` and the breakdown the period page returns).
 */
export declare function make_income_expected_parts(r: RecurringForExpected, span_start_ms: number, span_end_ms: number, extra_dates_ms?: number[]): (due_ms: number) => CheckPart[];
export declare function build_expected_occurrences(r: RecurringForExpected, span_start_ms: number, span_end_ms: number): ExpectedOccurrence[];
//# sourceMappingURL=expected_occurrences.service.d.ts.map