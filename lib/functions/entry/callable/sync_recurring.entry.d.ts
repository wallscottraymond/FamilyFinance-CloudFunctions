/**
 * Sync Recurring Entry Point
 *
 * Callable function for syncing recurring transactions (inflows/outflows) from Plaid.
 * Rate limited to once per 15 minutes per item.
 *
 * @module entry/callable/sync_recurring
 */
/**
 * Callable function for syncing recurring transactions.
 *
 * Syncs recurring inflows and outflows from Plaid for a specific item.
 * Detects new recurring patterns, updates existing ones, and marks stale items.
 * Rate limited to once per 15 minutes per item.
 *
 * Returns sync results including counts of synced inflows/outflows.
 */
export declare const sync_recurring: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    inflowsSynced: number;
    outflowsSynced: number;
    inflowsStale: number;
    outflowsStale: number;
    mergeSuggestions: number;
    errors: string[] | undefined;
    error: string | undefined;
    traceId: string;
}>, unknown>;
//# sourceMappingURL=sync_recurring.entry.d.ts.map