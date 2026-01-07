/**
 * Budget Deletion Trigger - Auto-Recreation Safety Net
 *
 * Firestore trigger that fires when a budget document is deleted.
 * Automatically recreates "everything else" budgets if they are deleted
 * (either accidentally or by bypassing Cloud Functions/security rules).
 *
 * This is a safety net to ensure users always have an "everything else" budget.
 */
/**
 * Trigger: Budget document deleted
 *
 * Monitors budget deletions and automatically recreates "everything else" budgets
 * if they are deleted (safety net for direct Firestore access).
 *
 * **Process:**
 * 1. Check if deleted budget is a system "everything else" budget
 * 2. If yes, recreate it immediately for the user
 * 3. If no, do nothing (normal budget deletion)
 *
 * **Safety Net Scenarios:**
 * - User manually deletes from Firestore console
 * - Admin bypasses security rules
 * - Bug in deletion prevention logic
 * - Direct API access circumventing protections
 */
export declare const onBudgetDelete: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    budgetId: string;
}>>;
//# sourceMappingURL=onBudgetDelete.d.ts.map