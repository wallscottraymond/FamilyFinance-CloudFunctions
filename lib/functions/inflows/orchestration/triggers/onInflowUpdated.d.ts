/**
 * Inflow Updated Trigger
 *
 * This Cloud Function automatically updates inflow_periods when an inflow is modified.
 * It handles changes to amount, custom name, and transaction IDs.
 *
 * Key Features:
 * - Detects changes to averageAmount, userCustomName, transactionIds
 * - Cascades updates to all related inflow_periods
 * - Re-runs transaction alignment when new transactions are added
 * - Preserves received income data (only updates unreceived periods for amounts)
 *
 * Memory: 512MiB, Timeout: 60s
 */
/**
 * Triggered when an inflow is updated
 * Automatically cascades changes to inflow_periods
 */
export declare const onInflowUpdated: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    inflowId: string;
}>>;
//# sourceMappingURL=onInflowUpdated.d.ts.map