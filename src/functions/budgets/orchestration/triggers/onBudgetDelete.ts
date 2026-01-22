/**
 * Budget Deletion Trigger - Auto-Recreation Safety Net
 *
 * Firestore trigger that fires when a budget document is deleted.
 * Automatically recreates "everything else" budgets if they are deleted
 * (either accidentally or by bypassing Cloud Functions/security rules).
 *
 * This is a safety net to ensure users always have an "everything else" budget.
 */

import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { db } from '../../../../index';
import { createEverythingElseBudget } from '../../utils/createEverythingElseBudget';

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
export const onBudgetDelete = onDocumentDeleted({
  document: 'budgets/{budgetId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (event) => {
  const budgetId = event.params.budgetId;
  const budgetData = event.data?.data();

  console.log(`🗑️ [onBudgetDelete] Budget deleted: ${budgetId}`);

  // 1. Check if event data exists
  if (!budgetData) {
    console.warn(`⚠️ [onBudgetDelete] No data available for deleted budget: ${budgetId}`);
    return;
  }

  // 2. Extract user information
  const userId = budgetData.createdBy;
  if (!userId) {
    console.error(`❌ [onBudgetDelete] Cannot process deletion: missing createdBy field`);
    return;
  }

  // 3. Reassign transactions from deleted budget to active budgets
  // This runs for ALL budget deletions (regular and system)
  console.log(`🔄 [onBudgetDelete] Reassigning transactions from deleted budget ${budgetId} for user ${userId}`);

  try {
    const { reassignTransactionsFromDeletedBudget } = await import('../../utils/reassignTransactionsFromDeletedBudget');
    const result = await reassignTransactionsFromDeletedBudget(budgetId, userId);

    if (result.success) {
      console.log(`✅ [onBudgetDelete] Transaction reassignment completed:`, {
        transactionsReassigned: result.transactionsReassigned,
        budgetAssignments: result.budgetAssignments,
        batchCount: result.batchCount,
        errors: result.errors.length
      });
    } else {
      console.error(`❌ [onBudgetDelete] Transaction reassignment failed:`, result.error);
    }
  } catch (reassignError: any) {
    console.error(`❌ [onBudgetDelete] Error during transaction reassignment:`, reassignError);
    // Non-blocking - budget deletion completes even if reassignment fails
  }

  // 4. Check if this was a system "everything else" budget
  if (!budgetData.isSystemEverythingElse) {
    console.log(`✅ [onBudgetDelete] Regular budget deleted (not system budget): ${budgetId}`);
    return;
  }

  // 5. System budget was deleted - this should not happen!
  console.warn(`⚠️ [onBudgetDelete] "Everything else" budget deleted for user ${userId}. Recreating...`);

  try {
    // 6. Extract user currency
    const userCurrency = budgetData.currency || 'USD';

    // 7. Recreate the "everything else" budget
    const newBudgetId = await createEverythingElseBudget(db, userId, userCurrency);

    console.log(`✅ [onBudgetDelete] Successfully recreated "everything else" budget for user ${userId}: ${newBudgetId}`);

  } catch (error: any) {
    console.error(`❌ [onBudgetDelete] Failed to recreate "everything else" budget:`, error);
    // Note: We don't throw here - this is a safety net, not a critical operation
    // The user can still use the app, but should manually create the budget
  }
});
