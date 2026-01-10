/**
 * Budget Update Trigger
 *
 * Automatically reassigns transactions when budget categories change.
 * Listens for updates to budget documents and triggers transaction reassignment
 * if categoryIds have been modified.
 *
 * Memory: 512MiB (higher for potential large reassignments)
 * Timeout: 60s (longer for batch operations)
 */
/**
 * Trigger: Reassign transactions when budget categories change
 *
 * Fires when a budget document is updated. Detects if categoryIds changed
 * and reassigns all affected transactions to the correct budgets.
 */
export declare const onBudgetUpdatedReassignTransactions: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    budgetId: string;
}>>;
//# sourceMappingURL=onBudgetUpdate.d.ts.map