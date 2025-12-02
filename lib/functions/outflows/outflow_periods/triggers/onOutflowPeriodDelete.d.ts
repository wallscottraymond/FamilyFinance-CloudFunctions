/**
 * Outflow Period Post-Deletion Orchestration
 *
 * This Cloud Function is triggered when an outflow_period is deleted.
 * It handles post-deletion operations including summary recalculation.
 *
 * Memory: 256MiB, Timeout: 30s
 */
/**
 * Triggered when an outflow_period is deleted
 * Updates summaries to reflect the deletion
 */
export declare const onOutflowPeriodDelete: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowPeriodId: string;
}>>;
//# sourceMappingURL=onOutflowPeriodDelete.d.ts.map