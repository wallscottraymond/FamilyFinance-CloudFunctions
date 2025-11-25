/**
 * Sync Balances Function
 *
 * Fetches current account balances from Plaid and updates the accounts collection.
 * This function is called by the onPlaidItemCreated trigger and can also be
 * called manually for balance refreshes.
 *
 * Flow:
 * 1. Look up plaid_item by plaidItemId to get access token
 * 2. Call Plaid /accounts/balance/get
 * 3. Update accounts collection with latest balances
 *
 * Memory: 256MiB, Timeout: 60s
 */
/**
 * Callable function for manual balance sync
 */
export declare const syncBalancesCallable: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    accountsUpdated: number;
    errors: string[];
    success: boolean;
}>>;
/**
 * Internal sync balances function (called by trigger and callable function)
 *
 * @param plaidItemId - The Plaid item ID
 * @param userId - The user ID (for validation)
 * @returns Sync result with account counts
 */
export declare function syncBalances(plaidItemId: string, userId: string): Promise<{
    accountsUpdated: number;
    errors: string[];
}>;
//# sourceMappingURL=syncBalances.d.ts.map