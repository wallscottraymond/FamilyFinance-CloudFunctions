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
import { RecurringType } from "../../resolvers/recurring/period_reconciliation.resolver";
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
export declare function reconcile_recurring_periods_orchestrator(ctx: TraceContext, input: ReconcileRecurringPeriodInput): Promise<ReconcileRecurringPeriodResult>;
//# sourceMappingURL=reconcile_recurring_periods.orchestrator.d.ts.map