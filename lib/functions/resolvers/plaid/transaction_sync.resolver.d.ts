/**
 * Transaction Sync Resolver
 *
 * Gathers dependencies for the transaction sync orchestrator.
 * - Fetches plaid_item and decrypts access token
 * - Gets user context (family, currency, groups)
 * - Fetches pending transactions for migration lookup
 *
 * @module resolvers/plaid/transaction_sync
 */
import { TraceContext } from "../../types";
import { ResolveTransactionSyncInput, TransactionSyncDependencies } from "../../types/plaid";
/**
 * Resolves dependencies needed for the transaction sync orchestrator.
 *
 * This resolver:
 * 1. Fetches the plaid_item by doc ID
 * 2. Decrypts the access token
 * 3. Gets user context (family, currency, groups)
 * 4. Fetches pending transactions for the item (for migration lookup)
 *
 * @param ctx - Trace context
 * @param input - Transaction sync input
 * @returns Dependencies for the orchestrator
 */
export declare function resolve_transaction_sync_dependencies(ctx: TraceContext, input: ResolveTransactionSyncInput): Promise<TransactionSyncDependencies | null>;
/**
 * Resolves dependencies for webhook-triggered transaction sync.
 *
 * Similar to above but looks up item by Plaid item ID instead of doc ID.
 *
 * @param ctx - Trace context
 * @param plaid_item_id - Plaid item ID (from webhook)
 * @returns Dependencies for the orchestrator, or null if item not found
 */
export declare function resolve_webhook_transaction_sync_dependencies(ctx: TraceContext, plaid_item_id: string): Promise<TransactionSyncDependencies | null>;
//# sourceMappingURL=transaction_sync.resolver.d.ts.map