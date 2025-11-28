/**
 * Trigger: Update user period summary when an inflow period is created
 *
 * When a new inflow_period is created, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export declare const onInflowPeriodCreatedPeriodSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    inflowPeriodId: string;
}>>;
/**
 * Trigger: Update user period summary when an inflow period is updated
 *
 * When an inflow_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export declare const onInflowPeriodUpdatedPeriodSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    inflowPeriodId: string;
}>>;
/**
 * Trigger: Update user period summary when an inflow period is deleted
 *
 * When an inflow_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export declare const onInflowPeriodDeletedPeriodSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    inflowPeriodId: string;
}>>;
//# sourceMappingURL=inflowPeriodSummaryTriggers.d.ts.map