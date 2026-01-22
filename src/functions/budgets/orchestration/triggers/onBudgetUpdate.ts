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

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { reassignTransactionsForBudget } from "../../utils/reassignTransactions";

/**
 * Trigger: Reassign transactions when budget categories change
 *
 * Fires when a budget document is updated. Detects if categoryIds changed
 * and reassigns all affected transactions to the correct budgets.
 */
export const onBudgetUpdatedReassignTransactions = onDocumentUpdated({
  document: "budgets/{budgetId}",
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60
}, async (event) => {
  const beforeData = event.data?.before.data();
  const afterData = event.data?.after.data();

  if (!beforeData || !afterData) {
    console.error("[onBudgetUpdate] Missing before or after data");
    return;
  }

  const budgetId = event.params.budgetId;
  console.log(`[onBudgetUpdate] Budget updated: ${budgetId} (${afterData.name})`);

  // Detect if categoryIds changed using JSON comparison
  const categoriesBefore = JSON.stringify(beforeData.categoryIds || []);
  const categoriesAfter = JSON.stringify(afterData.categoryIds || []);

  if (categoriesBefore === categoriesAfter) {
    console.log("[onBudgetUpdate] No category changes detected, skipping reassignment");
    return;
  }

  console.log("[onBudgetUpdate] Category changes detected:");
  console.log(`  Before: ${categoriesBefore}`);
  console.log(`  After: ${categoriesAfter}`);

  // Get userId from budget (handle both new access structure and legacy)
  const userId = afterData.userId || afterData.access?.createdBy;

  if (!userId) {
    console.error("[onBudgetUpdate] No userId found in budget document");
    return;
  }

  try {
    // Reassign all transactions for this budget
    console.log(`[onBudgetUpdate] Starting transaction reassignment for budget: ${budgetId}`);
    const reassignedCount = await reassignTransactionsForBudget(budgetId, userId);

    console.log(`[onBudgetUpdate] Successfully reassigned ${reassignedCount} transactions for budget: ${budgetId}`);

    // Note: Transaction updates will trigger their own budget spending updates
    // via onTransactionUpdate trigger, so we don't need to manually update
    // budget_periods here

  } catch (error) {
    console.error("[onBudgetUpdate] Error reassigning transactions:", error);
    // Don't throw - we don't want to fail the budget update
    // Transactions remain in their current state, user can manually reassign if needed
  }
});
