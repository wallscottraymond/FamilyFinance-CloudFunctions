/**
 * Outflow Period Summary Update on Creation
 *
 * This trigger updates the outflow summary when a new outflow_period is created.
 * It recalculates the affected sourcePeriodId group to ensure accurate aggregations.
 *
 * Memory: 256MiB, Timeout: 30s
 */
/**
 * Triggered when an outflow_period is created
 * Updates user and group summaries by recalculating the affected period group
 */
export declare const onOutflowPeriodCreatedSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowPeriodId: string;
}>>;
//# sourceMappingURL=onOutflowPeriodCreatedSummary.d.ts.map