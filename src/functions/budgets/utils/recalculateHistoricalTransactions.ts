/**
 * Historical Transaction Recalculation Utility
 *
 * Updates both transaction.splits[].budgetId AND budget_periods.spent
 * when a new budget is created with historical date ranges.
 *
 * This fixes the mismatch where budget_periods.spent updates but
 * transaction.splits[].budgetId doesn't.
 */

import { getFirestore, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { Transaction } from '../../../types';
import { updateBudgetSpending } from '../../../utils/budgetSpending';

const db = getFirestore();
const MAX_BATCH_SIZE = 500;

/**
 * Recalculate historical transactions and budget spending for a new budget
 *
 * @param budgetId - Budget ID
 * @param userId - User ID
 * @param categoryIds - Categories this budget tracks
 * @param startDate - Budget start date
 * @param endDate - Budget end date (null for ongoing budgets)
 * @returns Object with counts of transactions and budget periods updated
 */
export async function recalculateHistoricalTransactions(
  budgetId: string,
  userId: string,
  categoryIds: string[],
  startDate: Timestamp,
  endDate: Timestamp | null
): Promise<{ transactionsUpdated: number; spendingUpdated: number }> {
  console.log(
    `[recalculateHistoricalTransactions] Starting recalculation for budget: ${budgetId}, ` +
    `user: ${userId}, categories: ${categoryIds.join(', ')}`
  );

  const startTime = Date.now();

  try {
    // Step 1: Find all historical transactions in date range
    let transactionsQuery = db.collection('transactions')
      .where('ownerId', '==', userId)
      .where('transactionDate', '>=', startDate);

    if (endDate) {
      transactionsQuery = transactionsQuery.where('transactionDate', '<=', endDate);
    }

    const transactionsSnapshot = await transactionsQuery.get();

    console.log(
      `[recalculateHistoricalTransactions] Found ${transactionsSnapshot.size} transactions ` +
      `in date range for user ${userId}`
    );

    // Step 2: Filter transactions and identify those needing updates
    const transactionsToUpdate: Array<{
      ref: FirebaseFirestore.DocumentReference;
      oldSplits: any[];
      newSplits: any[];
    }> = [];

    transactionsSnapshot.docs.forEach(doc => {
      const transaction = { id: doc.id, ...doc.data() } as Transaction;
      let needsUpdate = false;
      const updatedSplits = [];

      // Check if any split matches budget categories
      for (const split of transaction.splits || []) {
        if (categoryIds.includes(split.plaidPrimaryCategory) ||
            categoryIds.includes(split.plaidDetailedCategory) ||
            (split.internalPrimaryCategory && categoryIds.includes(split.internalPrimaryCategory)) ||
            (split.internalDetailedCategory && categoryIds.includes(split.internalDetailedCategory))) {

          // This split should be assigned to the new budget
          if (split.budgetId !== budgetId) {
            needsUpdate = true;
            updatedSplits.push({ ...split, budgetId, updatedAt: Timestamp.now() });
          } else {
            updatedSplits.push(split);
          }
        } else {
          updatedSplits.push(split);
        }
      }

      if (needsUpdate) {
        transactionsToUpdate.push({
          ref: doc.ref,
          oldSplits: transaction.splits || [],
          newSplits: updatedSplits
        });
      }
    });

    console.log(
      `[recalculateHistoricalTransactions] ${transactionsToUpdate.length} transactions ` +
      `need budget reassignment`
    );

    // Step 3: Update transaction documents in batches
    let transactionsUpdated = 0;

    if (transactionsToUpdate.length > 0) {
      const batches: WriteBatch[] = [];
      let currentBatch = db.batch();
      let operationsInBatch = 0;

      for (const update of transactionsToUpdate) {
        if (operationsInBatch >= MAX_BATCH_SIZE) {
          batches.push(currentBatch);
          currentBatch = db.batch();
          operationsInBatch = 0;
        }

        currentBatch.update(update.ref, {
          splits: update.newSplits,
          updatedAt: Timestamp.now()
        });

        operationsInBatch++;
        transactionsUpdated++;
      }

      // Add the last batch if it has operations
      if (operationsInBatch > 0) {
        batches.push(currentBatch);
      }

      // Commit all batches sequentially
      for (let i = 0; i < batches.length; i++) {
        await batches[i].commit();
        console.log(
          `[recalculateHistoricalTransactions] Committed transaction batch ${i + 1}/${batches.length} ` +
          `(${Math.min((i + 1) * MAX_BATCH_SIZE, transactionsUpdated)} transactions)`
        );
      }
    }

    // Step 4: Recalculate budget_periods.spent using existing utility
    // This updates budget_periods based on the newly assigned splits
    let spendingUpdated = 0;

    if (transactionsToUpdate.length > 0) {
      console.log('[recalculateHistoricalTransactions] Recalculating budget_periods.spent');

      // For each updated transaction, trigger spending recalculation
      for (const update of transactionsToUpdate) {
        const transactionData = (await update.ref.get()).data() as Transaction;

        try {
          await updateBudgetSpending({
            newTransaction: { ...transactionData, id: update.ref.id },
            userId,
            groupId: transactionData.groupId
          });
          spendingUpdated++;
        } catch (error) {
          console.error(
            `[recalculateHistoricalTransactions] Error updating spending for transaction ${update.ref.id}:`,
            error
          );
          // Continue with other transactions
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[recalculateHistoricalTransactions] Completed in ${duration}ms - ` +
      `${transactionsUpdated} transactions updated, ${spendingUpdated} budget periods updated`
    );

    return { transactionsUpdated, spendingUpdated };

  } catch (error) {
    console.error('[recalculateHistoricalTransactions] Error during recalculation:', error);
    throw error;
  }
}

/**
 * Recalculate budget spending for existing transactions (legacy function)
 *
 * This is the original implementation that only updates budget_periods.spent
 * without updating transaction.splits[].budgetId.
 *
 * @deprecated Use recalculateHistoricalTransactions instead
 */
export async function recalculateBudgetSpendingOnCreate(
  budgetId: string,
  userId: string,
  categoryIds: string[],
  startDate: Timestamp,
  endDate: Timestamp | null
): Promise<number> {
  console.log('[recalculateBudgetSpendingOnCreate] DEPRECATED: Use recalculateHistoricalTransactions instead');

  const result = await recalculateHistoricalTransactions(budgetId, userId, categoryIds, startDate, endDate);
  return result.spendingUpdated;
}
