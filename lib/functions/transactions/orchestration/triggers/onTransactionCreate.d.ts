/**
 * Transaction Creation Trigger
 *
 * Automatically triggered when a new transaction is created in Firestore.
 * Handles budget spending updates and other post-creation orchestration tasks.
 *
 * Key Features:
 * - Updates budget_periods spent amounts based on transaction splits
 * - Handles both manual and Plaid-imported transactions
 * - Supports split transactions with multiple budget assignments
 * - Integrates with existing budget spending calculation logic
 *
 * Memory: 256MiB, Timeout: 60s
 */
/**
 * Triggered when a transaction document is created
 * Automatically updates budget spending based on transaction splits
 */
export declare const onTransactionCreate: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    transactionId: string;
}>>;
//# sourceMappingURL=onTransactionCreate.d.ts.map