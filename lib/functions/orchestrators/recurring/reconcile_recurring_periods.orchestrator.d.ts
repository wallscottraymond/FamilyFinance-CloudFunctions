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
import { TraceContext } from "../../types";
import { resolve_recurring_reconciliation, RecurringType } from "../../resolvers/recurring/period_reconciliation.resolver";
import { ReconciliationResult } from "../../domain/recurring/period_reconciliation.service";
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
/** Steps 1-3 of a reconcile: what each period's paid / received state should be. */
export interface ComputedReconciliation {
    resolved: Awaited<ReturnType<typeof resolve_recurring_reconciliation>>;
    to_reconcile: Awaited<ReturnType<typeof resolve_recurring_reconciliation>>["periods"];
    results: ReconciliationResult[];
    carried_into: Map<string, Array<{
        due_ms: number;
        payment_ms: number;
    }>>;
    activate: Map<string, Awaited<ReturnType<typeof resolve_recurring_reconciliation>>["periods"][number]>;
    intervals: Awaited<ReturnType<typeof resolve_recurring_reconciliation>>["removal_intervals"];
}
/**
 * Resolve the recurring doc's periods + linked splits, align each split to one period per type and
 * compute every period's result. Reads only (null when it has no periods). The job writes the
 * results whose fingerprint changed; the F1 repair script (scripts/repair-recurring-received.ts)
 * compares them to the stored totals instead.
 */
export declare function compute_recurring_reconciliation(ctx: TraceContext, input: Pick<ReconcileRecurringPeriodInput, "recurring_id" | "recurring_type">): Promise<ComputedReconciliation | null>;
export declare function reconcile_recurring_periods_orchestrator(ctx: TraceContext, input: ReconcileRecurringPeriodInput): Promise<ReconcileRecurringPeriodResult>;
//# sourceMappingURL=reconcile_recurring_periods.orchestrator.d.ts.map