/**
 * Transaction Deletion Trigger
 *
 * Automatically triggered when a transaction is deleted from Firestore.
 * Handles budget spending reversal and cleanup operations.
 *
 * Key Features:
 * - Reverses budget_periods spent amounts when transaction is deleted
 * - Handles split transactions with multiple budget assignments
 * - Ensures budget spending accuracy after transaction removal
 * - Supports both manual and automated transaction deletions
 *
 * Memory: 256MiB, Timeout: 60s
 */
/**
 * Triggered when a transaction document is deleted
 * Automatically reverses budget spending for the deleted transaction
 */
export declare const onTransactionDelete: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    transactionId: string;
}>>;
//# sourceMappingURL=onTransactionDelete.d.ts.map