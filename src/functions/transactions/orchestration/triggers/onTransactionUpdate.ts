/**
 * Transaction Update Trigger
 *
 * Automatically triggered when a transaction is updated in Firestore.
 * Handles budget spending recalculation when transaction details change.
 *
 * Key Features:
 * - Recalculates budget_periods spent amounts based on transaction changes
 * - Handles changes to splits (added, removed, or amount modified)
 * - Supports budget reassignment (moving transaction between budgets)
 * - Reverses old spending and applies new spending atomically
 *
 * Memory: 256MiB, Timeout: 60s
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { Transaction } from '../../../../types';
import { updateBudgetSpending } from '../../../../utils/budgetSpending';

/**
 * Triggered when a transaction document is updated
 * Automatically recalculates budget spending based on changes
 */
export const onTransactionUpdate = onDocumentUpdated({
  document: 'transactions/{transactionId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const transactionId = event.params.transactionId;
    const beforeData = event.data?.before.data() as Transaction;
    const afterData = event.data?.after.data() as Transaction;

    if (!beforeData || !afterData) {
      console.error('[onTransactionUpdate] Missing transaction data');
      return;
    }

    console.log(`[onTransactionUpdate] Processing transaction update: ${transactionId}`, {
      ownerId: afterData.ownerId,
      oldSplitCount: beforeData.splits?.length || 0,
      newSplitCount: afterData.splits?.length || 0,
      transactionDate: afterData.transactionDate
    });

    // Check if spending-related fields have changed
    const hasSpendingChanges = detectSpendingChanges(beforeData, afterData);

    if (!hasSpendingChanges) {
      console.log('[onTransactionUpdate] No spending-related changes detected, skipping budget update');
      return;
    }

    console.log('[onTransactionUpdate] Spending changes detected:', {
      splitsChanged: JSON.stringify(beforeData.splits) !== JSON.stringify(afterData.splits),
      dateChanged: beforeData.transactionDate !== afterData.transactionDate
    });

    // Update budget spending (reverses old and applies new)
    try {
      const result = await updateBudgetSpending({
        oldTransaction: { ...beforeData, id: transactionId },
        newTransaction: { ...afterData, id: transactionId },
        userId: afterData.ownerId,
        groupId: afterData.groupId
      });

      console.log(`[onTransactionUpdate] Budget spending updated:`, {
        budgetPeriodsUpdated: result.budgetPeriodsUpdated,
        budgetsAffected: result.budgetsAffected,
        periodTypesUpdated: result.periodTypesUpdated
      });

      if (result.errors.length > 0) {
        console.error('[onTransactionUpdate] Errors during budget update:', result.errors);
      }
    } catch (budgetError) {
      console.error('[onTransactionUpdate] Budget spending update failed:', budgetError);
      // Don't throw - we don't want to block transaction updates if budget update fails
    }

    console.log(`[onTransactionUpdate] Successfully processed transaction update: ${transactionId}`);

  } catch (error) {
    console.error('[onTransactionUpdate] Error processing transaction update:', error);
    // Don't throw - we don't want to fail the transaction update
  }
});

/**
 * Detect if spending-related fields have changed
 * Returns true if budget spending needs to be recalculated
 */
function detectSpendingChanges(before: Transaction, after: Transaction): boolean {
  // Check if splits have changed
  const splitsBefore = JSON.stringify(before.splits || []);
  const splitsAfter = JSON.stringify(after.splits || []);

  if (splitsBefore !== splitsAfter) {
    return true;
  }

  // Check if transaction date changed (affects which periods get the spending)
  if (before.transactionDate?.toMillis() !== after.transactionDate?.toMillis()) {
    return true;
  }

  // No spending-related changes
  return false;
}
