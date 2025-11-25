/**
 * Create Test Transactions - Admin Function
 *
 * Simulates a Plaid /transactions/sync response and runs the complete
 * transaction creation pipeline to test the production flow.
 *
 * This function:
 * 1. Simulates Plaid /transactions/sync response
 * 2. Runs the complete transaction pipeline (format → match → create)
 * 3. Returns statistics on transactions created/modified/removed
 *
 * Memory: 512MiB, Timeout: 120s
 */
export declare const createTestTransactions: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=createTestTransactions.d.ts.map