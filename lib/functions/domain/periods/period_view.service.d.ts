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
import { DerivedBudgetViewPeriod } from "../budgets/budget_view.service";
import { generate_expected_occurrences_in_window } from "../outflows/outflow_period.service";
import type { ActualPayment } from "../recurring/reconcile_occurrences.service";
import { PlacedOccurrenceGroup } from "../recurring/occurrence_placement.service";
import { is_payment_suppressed } from "../recurring/recurring_suppression.service";
import type { ReconciledOccurrence } from "../recurring/reconcile_occurrences.service";
import { PeriodDerivationDeps } from "./period_derivation.types";
/** Synthetic income id for the "Other Income" bucket (unmatched real INCOME_* credits). */
export declare const OTHER_INCOME_ID = "__other_income__";
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
    /** Group views only (see RecurringForDerivation.owner_user_id). */
    owner_user_id?: string;
}
export interface DerivePeriodResult {
    view_cadence: PeriodInstanceType;
    budgets: DerivedBudgetResult[];
    bills: DerivedRecurringResult[];
    income: DerivedRecurringResult[];
}
export declare function compute_period_view(deps: PeriodDerivationDeps, view_cadence: PeriodInstanceType): DerivePeriodResult;
/**
 * The occurrences a removed / paused / ended item keeps (D26 month rule + D28): an occurrence due
 * in a month that isn't suppressed is kept (only inside the span — the D28 look-ahead adds
 * nothing else); one due in a suppressed month is dropped, unless it was paid EARLY by a payment
 * made in a month that isn't suppressed — then it is kept, dated at that payment (so it lands in
 * the payment's bucket), when the payment is inside the span. PURE.
 */
export declare function keep_unsuppressed(occurrences: ReconciledOccurrence[], intervals: Parameters<typeof is_payment_suppressed>[0], span_start_ms: number, span_end_ms: number): ReconciledOccurrence[];
/**
 * A bill payment the user PINNED to a period pays THAT period's FIRST due occurrence (from the
 * bill's schedule) — exactly the occurrence stored reconcile places it on (its due date), in every
 * period type. Here it settles only that occurrence, and only in the span containing its due date
 * (so a weekly bill pinned to a month pays one week, and a range derive counts it once). A pinned
 * period with no occurrence: placed at its midpoint (matches nothing). Unpinned payments pass
 * through unchanged. PURE.
 */
export declare function resolve_pinned_payments(payments: ActualPayment[], schedule: Parameters<typeof generate_expected_occurrences_in_window>[0], span_start_ms: number, span_end_ms: number): ActualPayment[];
//# sourceMappingURL=period_view.service.d.ts.map