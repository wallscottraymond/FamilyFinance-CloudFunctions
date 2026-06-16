/**
 * Assign Transactions Batch Orchestrator
 *
 * Bulk variant of `assign_transaction`: assigns the splits of MANY of a user's
 * transactions in ONE invocation, resolving the transaction-independent context
 * (budgets + categories) ONCE and reusing it across every transaction. This
 * removes the per-transaction re-read of budgets + the categories collection
 * that dominates a large re-assignment (e.g. the backfill migration).
 *
 * Assignment-only: it writes the engine-owned split fields but does NOT fan out
 * per-transaction `recompute_budget_spent` jobs — bulk callers (the backfill)
 * run a single authoritative full recompute per budget afterwards, so per-txn
 * scoped recomputes would be redundant. For single, trigger-driven edits use
 * `assign_transaction` (which keeps the scoped fan-out).
 *
 * @module orchestrators/transactions/assign_transactions_batch
 */
import { TraceContext } from "../../types";
/** Input: assign every listed transaction for one user. */
export interface AssignTransactionsBatchInput {
    user_id: string;
    transaction_ids: string[];
}
/** Result summary (handy for logs/tests). */
export interface AssignTransactionsBatchResult {
    processed: number;
    changed: number;
    not_found: number;
}
export declare function assign_transactions_batch_orchestrator(ctx: TraceContext, input: AssignTransactionsBatchInput): Promise<AssignTransactionsBatchResult>;
//# sourceMappingURL=assign_transactions_batch.orchestrator.d.ts.map