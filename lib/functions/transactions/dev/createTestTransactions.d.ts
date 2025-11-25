/**
 * Create Test Transactions - Development Function
 *
 * Seeds test transaction data into the local Firestore emulator by simulating
 * a Plaid /transactions/sync response and running it through the complete
 * production transaction pipeline.
 *
 * This function:
 * 1. Uses static Plaid test data (no actual Plaid API calls)
 * 2. Runs the complete 6-step transaction pipeline:
 *    - Format: Plaid → Internal structure
 *    - Match Categories: Category assignment
 *    - Match Source Periods: Period ID mapping (monthly/weekly/biweekly)
 *    - Match Budgets: Budget assignment
 *    - Match Outflows: Bill payment matching
 *    - Batch Create: Atomic Firestore write
 * 3. Creates real transactions in Firestore for testing
 *
 * Usage (Firebase Callable Function):
 *   Called from mobile app Dev Tools: "Create Test Transactions" button
 *
 * Memory: 512MiB, Timeout: 120s
 */
/**
 * Firebase Callable Function to create test transactions in local Firestore
 */
export declare const createTestTransactions: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    data: {
        targetUserId: string;
        testItemId: string;
        currency: string;
        transactionsAdded: number;
        transactionsModified: number;
        transactionsRemoved: number;
        createdTransactionIds: string[];
        errors: string[];
        simulatedResponse: {
            accounts: number;
            added: number;
            modified: number;
            removed: number;
        };
    };
    hint: string;
}>>;
//# sourceMappingURL=createTestTransactions.d.ts.map