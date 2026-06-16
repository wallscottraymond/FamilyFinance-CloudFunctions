/**
 * Regenerate Recurring Occurrences Orchestrator
 * (Recurring-Period-Reconciliation B — the `regenerate_recurring_occurrences` job body)
 *
 * Re-derives the occurrence data (`occurrenceDueDates`, `amountPerOccurrence`,
 * `numberOfOccurrencesInPeriod`, `expectedAmount`, ...) for a recurring doc's
 * EXISTING periods using the correct v2 generation domain, then MERGE-writes ONLY
 * those generation fields (preserving each period's reconciliation/payment state).
 * Finally enqueues a `reconcile_recurring_period` so status recomputes against the
 * corrected occurrence data.
 *
 * This fixes legacy periods that were generated without occurrence data (or with
 * stale/out-of-range dates), so multi-occurrence tracking ("paid twice" / weekly
 * bill in a monthly view) is accurate on the existing backlog — not just new docs.
 *
 * @module orchestrators/recurring/regenerate_recurring_occurrences
 */
import { TraceContext } from "../../types";
import { RecurringType } from "../../resolvers/recurring/period_reconciliation.resolver";
export interface RegenerateRecurringOccurrencesInput {
    recurring_id: string;
    recurring_type: RecurringType;
    user_id: string;
    trace_id: string;
}
export interface RegenerateRecurringOccurrencesResult {
    periods_updated: number;
    reconcile_enqueued: boolean;
    success: boolean;
}
export declare function regenerate_recurring_occurrences_orchestrator(ctx: TraceContext, input: RegenerateRecurringOccurrencesInput): Promise<RegenerateRecurringOccurrencesResult>;
//# sourceMappingURL=regenerate_recurring_occurrences.orchestrator.d.ts.map