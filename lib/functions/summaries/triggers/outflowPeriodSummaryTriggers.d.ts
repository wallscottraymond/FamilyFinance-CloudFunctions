/**
 * Outflow Period Summary Triggers
 *
 * Centralized triggers that update user_summaries when outflow_periods change.
 * These replace the old outflow_summaries system with the new unified user_summaries architecture.
 *
 * Trigger Flow:
 * 1. outflow_period created/updated/deleted
 * 2. Trigger fires
 * 3. Calls updateUserPeriodSummary() to recalculate the affected period
 * 4. user_summaries document updated with latest outflow data
 */
/**
 * Trigger: When an outflow_period is created
 *
 * Updates the user_summaries document for this period with the new outflow period entry.
 */
export declare const onOutflowPeriodCreatedSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowPeriodId: string;
}>>;
/**
 * Trigger: When an outflow_period is updated
 *
 * Recalculates the user_summaries document for this period to reflect changes.
 */
export declare const onOutflowPeriodUpdatedSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    outflowPeriodId: string;
}>>;
/**
 * Trigger: When an outflow_period is deleted
 *
 * Recalculates the user_summaries document to remove the deleted period entry.
 */
export declare const onOutflowPeriodDeletedSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowPeriodId: string;
}>>;
//# sourceMappingURL=outflowPeriodSummaryTriggers.d.ts.map