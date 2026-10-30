/**
 * Sync Transactions Orchestrator
 *
 * Coordinates the transaction synchronization flow:
 * 1. Resolver: Get plaid_item with access token and pending transactions
 * 2. Integration: Fetch transactions from Plaid /transactions/sync
 * 3. Transform: Convert Plaid format to domain format
 * 4. Domain: Validate and handle pending->posted migrations
 * 5. Pipeline: Run through existing 6-step processing (categories, periods, budgets, outflows)
 * 6. Repository: Persist transactions, soft-delete removed ones
 * 7. Events: Emit transaction sync events
 * 8. Update cursor for incremental sync
 *
 * One writer, one write per transaction: every page is pulled first, the assignment engine runs
 * in memory, each transaction is written once (stamped `syncRunId` so the per-transaction trigger
 * skips it), and ONE follow-up pass (bill/income reconcile, budget spent, transfer check, derive
 * bump) runs at the end — inline, not as hundreds of queued jobs.
 *
 * @module orchestrators/plaid/sync_transactions
 */
import { OrchestratorContext } from "../../types";
import { TransactionSyncInput, TransactionSyncResponse } from "../../types/plaid";
import { SyncFollowUps } from "./sync_follow_ups";
export interface SyncTransactionsOptions {
    /** Stamped on every written doc (`syncRunId`); defaults to the trace id. */
    run_id?: string;
    /** The caller (sync_item) runs the follow-ups once, merged with the recurring sync's. */
    defer_follow_ups?: boolean;
}
export interface TransactionSyncResult extends TransactionSyncResponse {
    /** Plaid's `transactions_update_status` (NOT_READY / INITIAL_UPDATE_COMPLETE / HISTORICAL_UPDATE_COMPLETE). */
    update_status?: string;
    /** An account in this pull isn't saved yet — nothing was written; save accounts and re-sync. */
    needs_accounts?: boolean;
    follow_ups: SyncFollowUps;
}
/**
 * Orchestrates the transaction synchronization flow.
 *
 * This orchestrator:
 * 1. Fetches transactions from Plaid using cursor-based pagination
 * 2. Processes added, modified, and removed transactions
 * 3. Handles pending->posted migrations to preserve user modifications
 * 4. Runs transactions through the 6-step processing pipeline
 * 5. Persists results to Firestore
 * 6. Updates the cursor for incremental sync
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Sync results with counts and next cursor
 */
export declare function sync_transactions_orchestrator(ctx: OrchestratorContext<TransactionSyncInput>, opts?: SyncTransactionsOptions): Promise<TransactionSyncResult>;
//# sourceMappingURL=sync_transactions.orchestrator.d.ts.map