/**
 * Sync Transactions Entry Point
 *
 * Callable function for syncing transactions from Plaid.
 * Rate limited to once per 5 minutes per item.
 *
 * NOTE: This only syncs transactions from Plaid to Firestore.
 * Budget calculations are handled by existing Firestore triggers.
 *
 * @module entry/callable/sync_transactions
 */
/**
 * Callable function for syncing transactions.
 *
 * Syncs transactions from Plaid for a specific item.
 * Uses cursor-based incremental sync for efficiency.
 * Rate limited to once per 5 minutes per item.
 *
 * Returns sync results including counts of added/modified/removed transactions.
 */
export declare const sync_transactions: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    addedCount: number;
    modifiedCount: number;
    removedCount: number;
    pendingMigratedCount: number;
    hasMore: boolean;
    nextCursor: string | null;
    error: string | undefined;
    traceId: string;
}>, unknown>;
//# sourceMappingURL=sync_transactions.entry.d.ts.map