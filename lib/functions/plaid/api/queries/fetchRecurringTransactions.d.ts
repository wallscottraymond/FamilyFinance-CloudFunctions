/**
 * Fetch Recurring Transactions Cloud Function
 *
 * Fetches recurring transaction streams from Plaid for a specific item or all user items.
 * This function calls the Plaid /transactions/recurring/get endpoint and stores the
 * recurring transaction data in Firestore.
 *
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - Encrypted access token handling
 * - Proper error handling and validation
 *
 * Memory: 512MiB, Timeout: 60s
 * CORS: Enabled for mobile app
 * Promise Pattern: ✓
 */
/**
 * Fetch Recurring Transactions
 */
export declare const fetchRecurringTransactions: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=fetchRecurringTransactions.d.ts.map