/**
 * Transaction Creation Trigger
 *
 * Automatically triggered when a new transaction is created in Firestore.
 * Handles budget spending updates and other post-creation orchestration tasks.
 *
 * Key Features:
 * - Updates budget_periods spent amounts based on transaction splits
 * - Handles both manual and Plaid-imported transactions
 * - Supports split transactions with multiple budget assignments
 * - Integrates with existing budget spending calculation logic
 *
 * Memory: 256MiB, Timeout: 60s
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { Transaction } from '../../../../types';
import { updateBudgetSpending } from '../../../../utils/budgetSpending';

/**
 * Triggered when a transaction document is created
 * Automatically updates budget spending based on transaction splits
 */
export const onTransactionCreate = onDocumentCreated({
  document: 'transactions/{transactionId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const transactionId = event.params.transactionId;
    const transactionData = event.data?.data() as Transaction;

    if (!transactionData) {
      console.error('[onTransactionCreate] No transaction data found');
      return;
    }

    console.log(`[onTransactionCreate] Processing new transaction: ${transactionId}`, {
      ownerId: transactionData.ownerId,
      amount: transactionData.splits?.reduce((sum, split) => sum + split.amount, 0),
      splitCount: transactionData.splits?.length || 0,
      transactionDate: transactionData.transactionDate
    });

    // Update budget spending based on transaction splits
    try {
      const result = await updateBudgetSpending({
        newTransaction: { ...transactionData, id: transactionId },
        userId: transactionData.ownerId,
        groupId: transactionData.groupId
      });

      console.log(`[onTransactionCreate] Budget spending updated:`, {
        budgetPeriodsUpdated: result.budgetPeriodsUpdated,
        budgetsAffected: result.budgetsAffected,
        periodTypesUpdated: result.periodTypesUpdated
      });

      if (result.errors.length > 0) {
        console.error('[onTransactionCreate] Errors during budget update:', result.errors);
      }
    } catch (budgetError) {
      console.error('[onTransactionCreate] Budget spending update failed:', budgetError);
      // Don't throw - we don't want to block transaction creation if budget update fails
    }

    console.log(`[onTransactionCreate] Successfully processed transaction: ${transactionId}`);

  } catch (error) {
    console.error('[onTransactionCreate] Error processing transaction creation:', error);
    // Don't throw - we don't want to fail the transaction creation
  }
});
