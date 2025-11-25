/**
 * Sync Recurring Transactions Function
 *
 * Fetches recurring transaction streams from Plaid and stores them in
 * the inflow (recurring income) and outflow (recurring expenses) collections.
 *
 * Flow:
 * 1. Look up plaid_item by plaidItemId to get access token
 * 2. Call Plaid /transactions/recurring/get
 * 3. Store inflow streams in inflow collection
 * 4. Store outflow streams in outflow collection
 *
 * Memory: 512MiB, Timeout: 120s
 */
/**
 * Callable function for manual recurring transaction sync
 */
export declare const syncRecurringTransactionsCallable: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    inflowsCreated: number;
    inflowsUpdated: number;
    outflowsCreated: number;
    outflowsUpdated: number;
    errors: string[];
    success: boolean;
}>>;
/**
 * Internal sync recurring transactions function (called by trigger and callable function)
 *
 * @param plaidItemId - The Plaid item ID
 * @param userId - The user ID
 * @returns Sync result with inflow/outflow counts
 */
export declare function syncRecurringTransactions(plaidItemId: string, userId: string): Promise<{
    inflowsCreated: number;
    inflowsUpdated: number;
    outflowsCreated: number;
    outflowsUpdated: number;
    errors: string[];
}>;
//# sourceMappingURL=syncRecurring.d.ts.map