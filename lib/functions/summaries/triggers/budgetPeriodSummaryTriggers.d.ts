/**
 * Trigger: Update user period summary when a budget period is created
 *
 * When a new budget_period is created, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export declare const onBudgetPeriodCreatedPeriodSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    budgetPeriodId: string;
}>>;
/**
 * Trigger: Update user period summary when a budget period is updated
 *
 * When a budget_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export declare const onBudgetPeriodUpdatedPeriodSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    budgetPeriodId: string;
}>>;
/**
 * Trigger: Update user period summary when a budget period is deleted
 *
 * When a budget_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export declare const onBudgetPeriodDeletedPeriodSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    budgetPeriodId: string;
}>>;
//# sourceMappingURL=budgetPeriodSummaryTriggers.d.ts.map