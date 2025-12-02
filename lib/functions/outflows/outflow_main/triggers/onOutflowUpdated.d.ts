/**
 * Outflow Update Orchestration
 *
 * Automatically updates outflow periods when parent outflow changes from:
 * - Plaid webhook updates (amount changes, new transactions)
 * - Manual user edits (custom name changes)
 *
 * Updates: Future unpaid periods only (preserves payment history)
 *
 * Triggers on changes to:
 * - averageAmount: Recalculates period withholding amounts
 * - userCustomName: Updates period descriptions
 * - transactionIds: Re-runs auto-matching for transaction assignments
 *
 * Memory: 512MiB, Timeout: 60s
 */
/**
 * Triggered when an outflow is updated
 * Automatically updates unpaid outflow_periods when relevant fields change
 */
export declare const onOutflowUpdated: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    outflowId: string;
}>>;
//# sourceMappingURL=onOutflowUpdated.d.ts.map