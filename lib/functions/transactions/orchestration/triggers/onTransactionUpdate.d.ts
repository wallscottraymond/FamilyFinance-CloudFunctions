/**
 * Transaction Update Trigger
 *
 * Automatically triggered when a transaction is updated in Firestore.
 * Handles budget spending recalculation when transaction details change.
 *
 * Key Features:
 * - Recalculates budget_periods spent amounts based on transaction changes
 * - Handles changes to splits (added, removed, or amount modified)
 * - Supports budget reassignment (moving transaction between budgets)
 * - Reverses old spending and applies new spending atomically
 *
 * Memory: 256MiB, Timeout: 60s
 */
/**
 * Triggered when a transaction document is updated
 * Automatically recalculates budget spending based on changes
 */
export declare const onTransactionUpdate: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    transactionId: string;
}>>;
//# sourceMappingURL=onTransactionUpdate.d.ts.map