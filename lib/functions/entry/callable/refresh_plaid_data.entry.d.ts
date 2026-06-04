/**
 * Refresh Plaid Data Entry Point
 *
 * Callable function for refreshing BOTH account balances AND transactions from Plaid.
 * Rate limited to once per 5 minutes per item (allows parallel refresh of multiple items).
 *
 * This is the main entry point for pull-to-refresh in the mobile app.
 *
 * @module entry/callable/refresh_plaid_data
 */
/**
 * Callable function for syncing account balances AND transactions.
 *
 * Refreshes both balances AND transactions from Plaid for all accounts or specific items.
 * Rate limited to once per 5 minutes per item (allows parallel refresh of multiple items).
 *
 * This is the main pull-to-refresh endpoint for the mobile app.
 *
 * Returns the updated accounts and transaction sync stats in the format expected by the frontend.
 */
export declare const refresh_plaid_data: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    accounts: import("../../types/plaid").ClientAccountData[];
    accountsUpdated: number;
    accountsFailed: number;
    balanceChanges: number;
    transactionsAdded: number;
    transactionsModified: number;
    transactionsRemoved: number;
    pendingMigrated: number;
    itemsSynced: number;
    itemsFailed: number;
    itemsRateLimited: number;
    errors: string[] | undefined;
    traceId: string;
}>, unknown>;
//# sourceMappingURL=refresh_plaid_data.entry.d.ts.map