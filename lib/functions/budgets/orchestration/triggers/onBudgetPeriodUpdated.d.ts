/**
 * Budget Period Update Trigger
 *
 * Handles budget_period document updates, specifically:
 * - Syncing userNotes to overlapping periods of other types
 * - Syncing checklistItems to overlapping periods
 * - Syncing modifiedAmount to overlapping periods
 *
 * This ensures that user-entered data is consistent across all
 * period views (monthly, weekly, bi-monthly) for the same budget.
 *
 * Memory: 256MiB (lightweight sync operations)
 * Timeout: 30s
 */
/**
 * Trigger: Sync budget period changes to overlapping periods
 *
 * Fires when a budget_period document is updated. Detects changes to
 * userNotes, checklistItems, and modifiedAmount and syncs them
 * to overlapping periods of other types.
 */
export declare const onBudgetPeriodUpdated: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    periodId: string;
}>>;
//# sourceMappingURL=onBudgetPeriodUpdated.d.ts.map