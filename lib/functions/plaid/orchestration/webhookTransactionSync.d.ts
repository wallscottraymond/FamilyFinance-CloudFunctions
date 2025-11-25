/**
 * Webhook Transaction Sync Orchestration
 *
 * Orchestrates the transaction sync process when triggered by Plaid webhooks.
 * This is a wrapper around the core sync logic that handles webhook-specific concerns.
 */
/**
 * Process webhook-triggered transaction sync
 *
 * Delegates to the core sync implementation in syncTransactions.ts
 *
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param itemDoc - Optional: pass item data directly from webhook to avoid extra lookup
 * @returns Sync result with counts
 */
export declare function processWebhookTransactionSync(itemId: string, userId: string, itemDoc?: any): Promise<{
    success: boolean;
    addedCount: number;
    modifiedCount: number;
    removedCount: number;
    error?: string;
}>;
//# sourceMappingURL=webhookTransactionSync.d.ts.map