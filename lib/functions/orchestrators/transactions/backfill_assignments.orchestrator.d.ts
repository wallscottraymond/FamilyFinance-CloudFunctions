/**
 * Backfill Assignments Orchestrator
 *
 * One-shot migration: re-run the Transaction Assignment Engine over existing
 * data so split assignments become engine-authoritative AND every budget
 * period's `spent` is rebuilt (invalidation-based) off the assigned splits.
 * Intended to run once right after the hard cutover off the legacy increment
 * model. Fully idempotent — safe to re-run.
 *
 * Self-fanning (one job type, no coordinator proliferation):
 *   - no `user_id` → enumerate users, enqueue one `backfill_assignments` job
 *     per user (so each user is its own ≤5-min job).
 *   - with `user_id` → enqueue `assign_transaction` per transaction (re-assign;
 *     fans out a date-scoped recompute only where assignment CHANGED) AND a FULL
 *     `recompute_budget_spent` per budget (rebuilds spent for EVERY period,
 *     covering the periods where assignment did NOT change but the legacy
 *     increment left stale/`$0` spent).
 *
 * Why both passes: `assign_transaction` skips the recompute fan-out when nothing
 * changed (loop prevention), so a per-budget full recompute is required to
 * guarantee all spent is correct — including periods that have no transactions
 * but carry a phantom balance from the old model.
 *
 * @module orchestrators/transactions/backfill_assignments
 */
import { TraceContext } from "../../types";
/** Input: backfill one user, or (no user_id) fan out to all users. */
export interface BackfillAssignmentsInput {
    user_id?: string;
}
/** Result summary (handy for logs/tests). */
export interface BackfillAssignmentsResult {
    mode: "fan_out_users" | "user";
    users_enqueued?: number;
    transactions_enqueued?: number;
    budgets_enqueued?: number;
    /** Budgets that had no periods and were re-provisioned (legacy EE budget). */
    budgets_healed?: number;
}
export declare function backfill_assignments_orchestrator(ctx: TraceContext, input: BackfillAssignmentsInput): Promise<BackfillAssignmentsResult>;
//# sourceMappingURL=backfill_assignments.orchestrator.d.ts.map