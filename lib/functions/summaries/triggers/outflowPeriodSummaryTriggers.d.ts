/**
 * Trigger: Update user period summary when an outflow period is created
 *
 * DISABLED: This trigger has been disabled to prevent duplicate summary updates
 * when outflows are created. The onOutflowCreated trigger now handles batch
 * summary updates for all periods after they are created.
 *
 * This trigger is commented out but preserved for reference. If you need to
 * re-enable individual period creation updates, uncomment the export below.
 */
/**
 * Trigger: Update user period summary when an outflow period is updated
 *
 * When an outflow_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export declare const onOutflowPeriodUpdatedPeriodSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    outflowPeriodId: string;
}>>;
/**
 * Trigger: Update user period summary when an outflow period is deleted
 *
 * When an outflow_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export declare const onOutflowPeriodDeletedPeriodSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowPeriodId: string;
}>>;
//# sourceMappingURL=outflowPeriodSummaryTriggers.d.ts.map