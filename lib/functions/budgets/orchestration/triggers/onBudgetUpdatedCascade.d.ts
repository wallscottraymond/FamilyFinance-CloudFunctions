/**
 * Budget Update Cascade Trigger
 *
 * Cascades budget field changes to budget_periods.
 * Handles: name, amount, description, alertThreshold changes.
 *
 * This trigger complements onBudgetUpdatedReassignTransactions which
 * handles categoryIds changes (transaction reassignment).
 *
 * Update Strategy:
 * - Changes cascade to current + future periods only
 * - Historical periods (periodEnd < today) are preserved
 * - Uses the same pattern as inflows/outflows
 *
 * Memory: 512MiB (for batch operations)
 * Timeout: 60s
 */
/**
 * Trigger: Cascade budget field changes to budget_periods
 *
 * Fires when a budget document is updated. Detects changes to
 * name, amount, description, alertThreshold and cascades them
 * to current + future budget_periods.
 */
export declare const onBudgetUpdatedCascade: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    budgetId: string;
}>>;
//# sourceMappingURL=onBudgetUpdatedCascade.d.ts.map