/**
 * Assign Transaction Orchestrator
 *
 * The Transaction Assignment Engine's IO shell. Coordinates:
 *   resolver (load context once) → compute_transaction_assignment (pure core)
 *   → skip-if-unchanged → single write of the split assignment (+ splitBudgetIds)
 *   → scoped fan-out (recompute touched budgets).
 *
 * The engine is the SINGLE writer of split assignment fields. Per-split decisions
 * are logged for "why did this land in Everything Else?" troubleshooting.
 *
 * NOTE: the `recompute_budget_spent` fan-out job's handler ships with the
 * Budget-Transaction-Spend-Pipeline sub-project; until then the job is enqueued
 * and harmlessly ignored by `on_job_created`.
 *
 * @module orchestrators/transactions/assign_transaction
 */
import { TraceContext } from "../../types";
/** Input: assign all splits of one transaction. */
export interface AssignTransactionInput {
    user_id: string;
    transaction_id: string;
}
/** Result (also handy for tests). */
export interface AssignTransactionResult {
    found: boolean;
    changed: boolean;
    /** Budgets whose spent may have changed (before ∪ after) — the fan-out scope. */
    touched_budget_ids: string[];
    assigned_splits: number;
}
/**
 * Assign a transaction's splits.
 */
export declare function assign_transaction_orchestrator(ctx: TraceContext, input: AssignTransactionInput): Promise<AssignTransactionResult>;
//# sourceMappingURL=assign_transaction.orchestrator.d.ts.map