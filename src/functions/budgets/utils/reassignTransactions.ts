/**
 * Transaction Reassignment Utility
 *
 * Reassigns transactions when budget categories change.
 * - Category Additions: Picks up unassigned transactions matching new categories
 * - Category Removals: Re-evaluates ALL splits in affected transactions (not just removed category)
 *
 * Key Features:
 * - Full transaction re-evaluation on category removal (user requirement)
 * - Batch processing (respects 500-doc Firestore limit)
 * - Comprehensive logging and statistics
 *
 * Called by: onBudgetUpdate trigger when categoryIds change
 */

import { getFirestore, WriteBatch, Timestamp } from 'firebase-admin/firestore';
import { Transaction } from '../../../types';
import { matchTransactionSplitsToBudgets } from '../../transactions/utils/matchTransactionSplitsToBudgets';

const db = getFirestore();
const MAX_BATCH_SIZE = 500; // Firestore batch write limit

/**
 * Category change information
 */
export interface CategoryChange {
  categoriesAdded: string[];
  categoriesRemoved: string[];
}

/**
 * Reassignment statistics
 */
export interface ReassignmentStats {
  success: boolean;
  transactionsReassigned: number;  // Renamed from transactionsProcessed for consistency
  splitsReassigned: number;
  errors: string[];
}

/**
 * Reassign transactions when budget categories change (ENHANCED VERSION)
 *
 * This function handles two scenarios:
 * 1. Category Additions: Picks up transactions with unassigned splits matching new categories
 * 2. Category Removals: Re-evaluates ALL splits in affected transactions (not just removed category)
 *
 * @param budgetId - Budget ID whose transactions need reassignment
 * @param userId - User ID for querying user-specific transactions
 * @param changes - Categories added/removed
 * @returns Reassignment statistics
 */
export async function reassignTransactionsForBudget(
  budgetId: string,
  userId: string,
  changes?: CategoryChange
): Promise<number | ReassignmentStats> {
  // If no changes provided, use legacy behavior
  if (!changes) {
    return reassignTransactionsForBudgetLegacy(budgetId, userId);
  }

  console.log(`[reassignTransactionsForBudget] Enhanced mode - budget: ${budgetId}, user: ${userId}`);
  console.log(`[reassignTransactionsForBudget] Changes:`, changes);

  const stats: ReassignmentStats = {
    success: true,
    transactionsReassigned: 0,
    splitsReassigned: 0,
    errors: []
  };

  try {
    // Verify budget exists
    const budgetDoc = await db.collection('budgets').doc(budgetId).get();
    if (!budgetDoc.exists) {
      stats.success = false;
      stats.errors.push('Budget not found');
      return stats;
    }

    // Get all active budgets for matching
    const activeBudgetsSnapshot = await db.collection('budgets')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .get();

    const allActiveBudgets: any[] = [];
    let everythingElseBudget: any = null;

    activeBudgetsSnapshot.forEach(doc => {
      const budget = {
        id: doc.id,
        startDate: doc.data().startDate,
        endDate: doc.data().endDate,
        budgetEndDate: doc.data().budgetEndDate,
        isOngoing: doc.data().isOngoing,
        categoryIds: doc.data().categoryIds || [],
        isSystemEverythingElse: doc.data().isSystemEverythingElse || false
      };

      if (budget.isSystemEverythingElse) {
        everythingElseBudget = budget;
      } else {
        allActiveBudgets.push(budget);
      }
    });

    console.log(`[reassignTransactionsForBudget] Found ${allActiveBudgets.length} active budgets`);

    // Determine which transactions to process
    let transactionsToProcess: any[] = [];

    // CATEGORY REMOVALS: Re-evaluate ALL splits in affected transactions
    if (changes.categoriesRemoved.length > 0) {
      console.log(`[reassignTransactionsForBudget] Processing ${changes.categoriesRemoved.length} category removals - will re-evaluate ALL splits`);

      const transactionsQuery = db.collection('transactions')
        .where('ownerId', '==', userId)
        .where('isActive', '==', true);

      const allTransactions = await transactionsQuery.get();

      // Filter to transactions with at least one split assigned to this budget
      transactionsToProcess = allTransactions.docs.filter(doc => {
        const data = doc.data();
        if (!data.splits || !Array.isArray(data.splits)) return false;
        return data.splits.some((split: any) => split.budgetId === budgetId);
      });

      console.log(`[reassignTransactionsForBudget] Found ${transactionsToProcess.length} transactions to re-evaluate`);
    }

    // CATEGORY ADDITIONS: Pick up unassigned transactions
    if (changes.categoriesAdded.length > 0) {
      console.log(`[reassignTransactionsForBudget] Processing ${changes.categoriesAdded.length} category additions`);

      const transactionsQuery = db.collection('transactions')
        .where('ownerId', '==', userId)
        .where('isActive', '==', true);

      const allTransactions = await transactionsQuery.get();

      // Filter to transactions with unassigned splits matching new categories
      const unassignedTransactions = allTransactions.docs.filter(doc => {
        const data = doc.data();
        if (!data.splits || !Array.isArray(data.splits)) return false;

        return data.splits.some((split: any) => {
          const isUnassigned = split.budgetId === 'unassigned' ||
                              split.budgetId === everythingElseBudget?.id;

          if (!isUnassigned) return false;

          // Check if split category matches any of the added categories
          const splitCategory = split.internalPrimaryCategory || split.plaidPrimaryCategory;
          return changes.categoriesAdded.some(addedCat =>
            splitCategory?.toLowerCase().includes(addedCat.toLowerCase())
          );
        });
      });

      // Merge with existing list (avoid duplicates)
      const existingIds = new Set(transactionsToProcess.map(doc => doc.id));
      unassignedTransactions.forEach(doc => {
        if (!existingIds.has(doc.id)) {
          transactionsToProcess.push(doc);
        }
      });

      console.log(`[reassignTransactionsForBudget] Added ${unassignedTransactions.length} unassigned transactions`);
    }

    if (transactionsToProcess.length === 0) {
      console.log(`[reassignTransactionsForBudget] No transactions to process`);
      return stats;
    }

    // Process transactions in batches
    const batches: any[][] = [];
    for (let i = 0; i < transactionsToProcess.length; i += MAX_BATCH_SIZE) {
      batches.push(transactionsToProcess.slice(i, i + MAX_BATCH_SIZE));
    }

    for (const batch of batches) {
      const firestoreBatch = db.batch();

      for (const txnDoc of batch) {
        try {
          const txnData = txnDoc.data();
          const transactionDate = txnData.transactionDate?.toDate();

          if (!transactionDate) {
            stats.errors.push(`Transaction ${txnDoc.id}: Missing transactionDate`);
            continue;
          }

          // Store original splits for comparison
          const originalSplits = JSON.stringify(txnData.splits.map((s: any) => s.budgetId));

          // Re-evaluate ALL splits using category-aware matching
          // Cast through unknown since we only need a subset of Transaction fields for matching
          const transactionToMatch = {
            id: txnDoc.id,
            ownerId: txnData.ownerId,
            transactionDate: txnData.transactionDate,
            amount: txnData.amount,
            splits: txnData.splits,
            isActive: txnData.isActive,
            createdAt: txnData.createdAt,
            updatedAt: txnData.updatedAt
          } as unknown as Transaction;

          // Use category-aware matching
          const matchedTransactions = await matchTransactionSplitsToBudgets([transactionToMatch], userId);

          if (matchedTransactions.length === 0) {
            stats.errors.push(`Transaction ${txnDoc.id}: Failed to match`);
            continue;
          }

          const matchedTransaction = matchedTransactions[0];
          const updatedSplits = matchedTransaction.splits;

          // Check if any splits changed
          const newSplits = JSON.stringify(updatedSplits.map((s: any) => s.budgetId));
          const splitsChanged = originalSplits !== newSplits;

          if (splitsChanged) {
            // Count how many splits changed
            for (let i = 0; i < updatedSplits.length; i++) {
              if (txnData.splits[i]?.budgetId !== updatedSplits[i]?.budgetId) {
                stats.splitsReassigned++;
              }
            }

            firestoreBatch.update(txnDoc.ref, {
              splits: updatedSplits,
              updatedAt: Timestamp.now()
            });
            stats.transactionsReassigned++;
          }
        } catch (error: any) {
          stats.errors.push(`Transaction ${txnDoc.id}: ${error.message}`);
        }
      }

      await firestoreBatch.commit();
      console.log(`[reassignTransactionsForBudget] Committed batch ${batches.indexOf(batch) + 1}/${batches.length}`);
    }

    console.log(`[reassignTransactionsForBudget] Completed: ${stats.transactionsReassigned} transactions, ${stats.splitsReassigned} splits reassigned`);
    return stats;
  } catch (error: any) {
    console.error(`[reassignTransactionsForBudget] Error:`, error);
    stats.errors.push(error.message);
    return stats;
  }
}

/**
 * LEGACY VERSION: Reassign all transactions for a specific budget
 *
 * @param budgetId - Budget ID whose transactions need reassignment
 * @param userId - User ID for querying user-specific transactions
 * @returns Count of transactions reassigned
 */
async function reassignTransactionsForBudgetLegacy(
  budgetId: string,
  userId: string
): Promise<number> {
  console.log(`[reassignTransactions] Starting reassignment for budget: ${budgetId}, user: ${userId}`);

  try {
    // Step 1: Find all transactions with splits assigned to this budget
    // Note: This query requires a composite index on (ownerId, splits.budgetId)
    const transactionsSnapshot = await db.collection('transactions')
      .where('ownerId', '==', userId)
      .where('isActive', '==', true)
      .get();

    if (transactionsSnapshot.empty) {
      console.log('[reassignTransactions] No transactions found for user');
      return 0;
    }

    console.log(`[reassignTransactions] Found ${transactionsSnapshot.size} transactions to check`);

    // Step 2: Filter transactions that have splits assigned to this budget
    const affectedTransactions: Transaction[] = [];
    transactionsSnapshot.docs.forEach(doc => {
      const transaction = { id: doc.id, ...doc.data() } as Transaction;
      const hasAffectedSplit = transaction.splits?.some(split => split.budgetId === budgetId);

      if (hasAffectedSplit) {
        affectedTransactions.push(transaction);
      }
    });

    if (affectedTransactions.length === 0) {
      console.log(`[reassignTransactions] No transactions assigned to budget ${budgetId}`);
      return 0;
    }

    console.log(`[reassignTransactions] Found ${affectedTransactions.length} transactions assigned to budget ${budgetId}`);

    // Step 3: Reassign all affected transactions
    const reassignedTransactions = await matchTransactionSplitsToBudgets(affectedTransactions, userId);

    // Step 4: Update transactions in batches (Firestore limit: 500 per batch)
    let reassignedCount = 0;
    const batches: WriteBatch[] = [];
    let currentBatch = db.batch();
    let operationsInBatch = 0;

    for (const transaction of reassignedTransactions) {
      if (operationsInBatch >= MAX_BATCH_SIZE) {
        batches.push(currentBatch);
        currentBatch = db.batch();
        operationsInBatch = 0;
      }

      const transactionRef = db.collection('transactions').doc(transaction.id);
      currentBatch.update(transactionRef, {
        splits: transaction.splits,
        updatedAt: new Date()
      });

      operationsInBatch++;
      reassignedCount++;
    }

    // Add the last batch if it has operations
    if (operationsInBatch > 0) {
      batches.push(currentBatch);
    }

    // Step 5: Commit all batches sequentially
    for (let i = 0; i < batches.length; i++) {
      await batches[i].commit();
      console.log(`[reassignTransactions] Committed batch ${i + 1}/${batches.length} (${Math.min((i + 1) * MAX_BATCH_SIZE, reassignedCount)} transactions)`);
    }

    console.log(`[reassignTransactions] Successfully reassigned ${reassignedCount} transactions`);
    return reassignedCount;

  } catch (error) {
    console.error('[reassignTransactions] Error reassigning transactions:', error);
    throw error;
  }
}

/**
 * Reassign all transactions for all budgets (useful for bulk operations)
 *
 * @param userId - User ID
 * @returns Total count of transactions reassigned
 */
export async function reassignAllTransactions(
  userId: string
): Promise<number> {
  console.log(`[reassignAllTransactions] Starting full reassignment for user: ${userId}`);

  try {
    // Get all active budgets for user
    const budgetsSnapshot = await db.collection('budgets')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .get();

    console.log(`[reassignAllTransactions] Found ${budgetsSnapshot.size} active budgets`);

    let totalReassigned = 0;

    for (const budgetDoc of budgetsSnapshot.docs) {
      const count = await reassignTransactionsForBudget(budgetDoc.id, userId);
      totalReassigned += typeof count === 'number' ? count : count.transactionsReassigned;
    }

    console.log(`[reassignAllTransactions] Total transactions reassigned: ${totalReassigned}`);
    return totalReassigned;

  } catch (error) {
    console.error('[reassignAllTransactions] Error in full reassignment:', error);
    throw error;
  }
}
