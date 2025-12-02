/**
 * Outflow Period Post-Update Orchestration
 *
 * This Cloud Function is triggered when an outflow_period is updated.
 * It handles post-update operations including summary recalculation.
 *
 * Memory: 256MiB, Timeout: 30s
 */
/**
 * Triggered when an outflow_period is updated
 * Updates summaries to reflect changes
 */
export declare const onOutflowPeriodUpdate: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    outflowPeriodId: string;
}>>;
//# sourceMappingURL=onOutflowPeriodUpdate.d.ts.map