/**
 * Transaction Deletion Trigger
 *
 * Automatically triggered when a transaction is deleted from Firestore.
 * Handles budget spending reversal and cleanup operations.
 *
 * Key Features:
 * - Reverses budget_periods spent amounts when transaction is deleted
 * - Handles split transactions with multiple budget assignments
 * - Ensures budget spending accuracy after transaction removal
 * - Supports both manual and automated transaction deletions
 *
 * Memory: 256MiB, Timeout: 60s
 */

import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { Transaction } from '../../../../types';
import { updateBudgetSpending } from '../../../../utils/budgetSpending';

/**
 * Triggered when a transaction document is deleted
 * Automatically reverses budget spending for the deleted transaction
 */
export const onTransactionDelete = onDocumentDeleted({
  document: 'transactions/{transactionId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const transactionId = event.params.transactionId;
    const transactionData = event.data?.data() as Transaction;

    if (!transactionData) {
      console.error('[onTransactionDelete] No transaction data found');
      return;
    }

    console.log(`[onTransactionDelete] Processing transaction deletion: ${transactionId}`, {
      ownerId: transactionData.ownerId,
      amount: transactionData.splits?.reduce((sum, split) => sum + split.amount, 0),
      splitCount: transactionData.splits?.length || 0,
      transactionDate: transactionData.transactionDate
    });

    // Reverse budget spending (pass oldTransaction, no newTransaction)
    try {
      const result = await updateBudgetSpending({
        oldTransaction: { ...transactionData, id: transactionId },
        newTransaction: undefined, // Indicates deletion
        userId: transactionData.ownerId,
        groupId: transactionData.groupId
      });

      console.log(`[onTransactionDelete] Budget spending reversed:`, {
        budgetPeriodsUpdated: result.budgetPeriodsUpdated,
        budgetsAffected: result.budgetsAffected,
        periodTypesUpdated: result.periodTypesUpdated
      });

      if (result.errors.length > 0) {
        console.error('[onTransactionDelete] Errors during budget update:', result.errors);
      }
    } catch (budgetError) {
      console.error('[onTransactionDelete] Budget spending reversal failed:', budgetError);
      // Log error but don't throw - deletion should complete even if budget update fails
    }

    console.log(`[onTransactionDelete] Successfully processed transaction deletion: ${transactionId}`);

  } catch (error) {
    console.error('[onTransactionDelete] Error processing transaction deletion:', error);
    // Don't throw - we don't want to block transaction deletion
  }
});
