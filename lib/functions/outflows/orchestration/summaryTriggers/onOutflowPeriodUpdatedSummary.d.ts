/**
 * Outflow Period Summary Update on Update
 *
 * This trigger updates the outflow summary when an outflow_period is updated.
 * It recalculates the affected sourcePeriodId group to reflect changes in amounts or status.
 *
 * Memory: 256MiB, Timeout: 30s
 */
/**
 * Triggered when an outflow_period is updated
 * Updates user and group summaries by recalculating the affected period group
 */
export declare const onOutflowPeriodUpdatedSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    outflowPeriodId: string;
}>>;
//# sourceMappingURL=onOutflowPeriodUpdatedSummary.d.ts.map