/**
 * Outflow Period Summary Update on Deletion
 *
 * This trigger updates the outflow summary when an outflow_period is deleted.
 * It recalculates the affected sourcePeriodId group, potentially removing it if empty.
 *
 * Memory: 256MiB, Timeout: 30s
 */
/**
 * Triggered when an outflow_period is deleted
 * Updates user and group summaries by recalculating the affected period group
 * If this was the last period in the group, the entire sourcePeriodId key is removed
 */
export declare const onOutflowPeriodDeletedSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowPeriodId: string;
}>>;
//# sourceMappingURL=onOutflowPeriodDeletedSummary.d.ts.map