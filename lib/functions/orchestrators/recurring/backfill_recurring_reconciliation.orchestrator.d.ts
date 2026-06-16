/**
 * Backfill Recurring Reconciliation Orchestrator
 * (Recurring-Period-Reconciliation Phase 7)
 *
 * Self-fanning coordinator (one job type):
 *   - no `user_id` → enumerate users, enqueue one per-user `backfill_recurring_reconciliation`.
 *   - with `user_id` → enqueue a `reconcile_recurring_period` per ACTIVE recurring
 *     outflow + inflow for that user.
 *
 * Reuses the Phase 3 reconcile job (idempotent) — safe to re-run.
 *
 * @module orchestrators/recurring/backfill_recurring_reconciliation
 */
import { TraceContext } from "../../types";
export interface BackfillRecurringReconciliationInput {
    /** Backfill one user; omit to fan out to all users. */
    user_id?: string;
    /**
     * When true, first REGENERATE each recurring doc's period occurrence data (via the
     * correct v2 generator) before reconciling — fixes legacy periods missing/with
     * stale occurrence data. Each per-doc `regenerate_recurring_occurrences` job
     * enqueues its own reconcile. When false (default), reconcile directly.
     */
    regenerate?: boolean;
}
export interface BackfillRecurringReconciliationResult {
    mode: "fan_out_users" | "user";
    users_enqueued?: number;
    reconciles_enqueued?: number;
}
export declare function backfill_recurring_reconciliation_orchestrator(ctx: TraceContext, input: BackfillRecurringReconciliationInput): Promise<BackfillRecurringReconciliationResult>;
//# sourceMappingURL=backfill_recurring_reconciliation.orchestrator.d.ts.map