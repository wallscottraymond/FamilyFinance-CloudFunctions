/**
 * Reconcile User Recurring (debounced batch) Orchestrator
 *
 * Collapses the per-recurring reconcile fan-out (TR-3). Creating a recurring item used to
 * enqueue TWO durable jobs — `assign_recurring_transactions` + `reconcile_recurring_period`
 * — PER item, so a bulk import (or a Plaid recurring sync writing N streams) fanned out to
 * ~2N jobs + 2N `on_job_created` invocations, each re-resolving context.
 *
 * Instead, `on_{outflow,inflow}_created` now enqueues ONE debounced job per user (dedup
 * `reconcile_user_recurring:{uid}`). This job reads the user's watermark, finds every active
 * recurring (outflow + inflow) updated since it that has linked transactions, then: (1) runs
 * ONE `assign_transactions_batch` over the UNION of all dirty streams' transactions — a single
 * candidate preload instead of one per bill (the #1 read line); (2) reconciles each stream's
 * own periods. So N streams cost 1 job + 1 assignment scan. Counts are small (tens), no paging.
 *
 * Watermark advances to the max `updatedAt` of the items processed (never past an unprocessed
 * row). Per-item failures are caught + logged (a single poison stream must not strand the
 * rest); reconcile/assign are idempotent, so a re-run is safe.
 *
 * @module orchestrators/recurring/reconcile_user_recurring
 */
import { TraceContext } from "../../types";
export interface ReconcileUserRecurringInput {
    user_id: string;
}
export declare function reconcile_user_recurring_orchestrator(ctx: TraceContext, input: ReconcileUserRecurringInput): Promise<{
    reconciled: number;
}>;
//# sourceMappingURL=reconcile_user_recurring.orchestrator.d.ts.map