/**
 * Plaid Transactions Sync Cloud Function
 *
 * Implements Plaid's /transactions/sync endpoint for real-time transaction synchronization.
 * This function is called when SYNC_UPDATES_AVAILABLE webhooks are received.
 *
 * Features:
 * - Uses Plaid's modern /transactions/sync endpoint
 * - Handles cursor-based pagination for incremental sync
 * - Stores raw Plaid transactions and converts to Family Finance format
 * - Manages transaction additions, modifications, and removals
 * - Implements proper error handling and retry logic
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */
/**
 * Sync transactions for a specific Plaid item using /transactions/sync
 */
export declare const syncTransactionsForItem: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    itemId: any;
    transactions: {
        added: number;
        modified: number;
        removed: number;
    };
    nextCursor: string | undefined;
    message: string;
}>>;
/**
 * Process webhook-triggered transaction sync (called by webhook handler)
 *
 * This is a wrapper around the main sync logic for webhook compatibility.
 * Uses the same unified transaction creation logic as manual sync.
 */
export declare function processWebhookTransactionSync(itemId: string, userId: string, itemDoc?: any): Promise<{
    success: boolean;
    addedCount: number;
    modifiedCount: number;
    removedCount: number;
    error?: string;
}>;
//# sourceMappingURL=syncTransactions.d.ts.map