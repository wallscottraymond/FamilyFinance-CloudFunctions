/**
 * Sync All Transactions Orchestrator (scheduled fallback)
 *
 * Iterates every active Plaid item across all users and runs the standard
 * transaction sync AND a balance refresh for each. This is a safety net: even if
 * a Plaid webhook is missed or rejected, transactions AND account balances still
 * flow on a schedule. (Transaction sync alone does NOT update balances, so
 * without the balance pass here, balances go stale between manual refreshes.)
 * Per-item failures are isolated so one bad item can't stop the rest.
 *
 * @module orchestrators/plaid/sync_all_transactions
 */
import { TraceContext } from "../../types";
export interface SyncAllTransactionsResult {
    items_total: number;
    items_synced: number;
    items_failed: number;
    added_total: number;
    modified_total: number;
    removed_total: number;
    balances_updated_total: number;
}
export declare function sync_all_transactions_orchestrator(ctx: TraceContext): Promise<SyncAllTransactionsResult>;
//# sourceMappingURL=sync_all_transactions.orchestrator.d.ts.map