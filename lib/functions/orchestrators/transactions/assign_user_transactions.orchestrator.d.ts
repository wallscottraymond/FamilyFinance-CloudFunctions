/**
 * Assign User Transactions (debounced batch) Orchestrator
 *
 * Replaces the per-transaction assignment fan-out on sync. `on_transaction_written` used to enqueue
 * ONE singular `assign_transaction` job per changed txn, and each re-read the ENTIRE reference set
 * (budgets + outflows + inflows + categories + source_periods) PLUS the `outflow_periods`/
 * `inflow_periods` recurring-candidate scans — so a Plaid-sync of N txns cost O(N × every reference
 * collection). That was the top Firestore read line (outflow_periods > 2× transactions).
 *
 * Instead, the trigger enqueues ONE debounced job per user (dedup `assign_user:{uid}`). This job
 * reads the user's watermark, fetches the transactions changed since it, and assigns them all via
 * `assign_transactions_batch` — which resolves the shared context ONCE and preloads the recurring
 * candidates ONCE. Reference reads drop from O(N) to O(1) per sync.
 *
 * Watermark advances ONLY on success (a failed/retried run re-processes from the old cursor, so no
 * txn is ever stranded). If a run hits the page cap there are more to do, so it re-enqueues itself.
 *
 * @module orchestrators/transactions/assign_user_transactions
 */
import { TraceContext } from "../../types";
export interface AssignUserTransactionsInput {
    user_id: string;
}
export declare function assign_user_transactions_orchestrator(ctx: TraceContext, input: AssignUserTransactionsInput): Promise<{
    assigned: number;
    more: boolean;
}>;
//# sourceMappingURL=assign_user_transactions.orchestrator.d.ts.map