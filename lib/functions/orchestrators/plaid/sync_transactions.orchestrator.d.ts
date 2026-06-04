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
 * NOTE: Budget calculations are handled by existing Firestore triggers.
 * This orchestrator only syncs transactions from Plaid to Firestore.
 *
 * @module orchestrators/plaid/sync_transactions
 */
import { OrchestratorContext } from "../../types";
import { TransactionSyncInput, TransactionSyncResponse } from "../../types/plaid";
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
export declare function sync_transactions_orchestrator(ctx: OrchestratorContext<TransactionSyncInput>): Promise<TransactionSyncResponse>;
//# sourceMappingURL=sync_transactions.orchestrator.d.ts.map