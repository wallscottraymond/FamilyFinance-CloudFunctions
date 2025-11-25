/**
 * Admin utility to re-process existing Plaid transactions
 *
 * This function will re-run the category mapping and budget period matching
 * for existing transactions to apply fixes.
 *
 * USE WITH CAUTION - This will modify existing transaction data
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../../../index';
import { Timestamp } from 'firebase-admin/firestore';
import { TransactionCategory } from '../../../types';

interface ReprocessRequest {
  userId?: string;  // Optional - if provided, only reprocess this user's transactions
  limit?: number;   // Optional - max transactions to process (default 100)
  dryRun?: boolean; // If true, only log what would be changed without updating
}

export const reprocessPlaidTransactions = onCall(
  {
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    try {
      console.log('🔄 Starting Plaid transaction reprocessing...');

      const { userId, limit = 100, dryRun = false } = request.data as ReprocessRequest;

      // Query transactions to reprocess
      let query = db.collection('transactions')
        .where('metadata.source', '==', 'plaid');

      if (userId) {
        query = query.where('userId', '==', userId);
      }

      query = query.limit(limit);

      const snapshot = await query.get();
      console.log(`Found ${snapshot.size} Plaid transactions to reprocess`);

      let updatedCount = 0;
      let skippedCount = 0;
      const changes: Array<{
        transactionId: string;
        changes: any;
      }> = [];

      for (const doc of snapshot.docs) {
        const transaction = doc.data();
        const plaidTransactionId = transaction.metadata?.plaidTransactionId;

        if (!plaidTransactionId) {
          console.warn(`Transaction ${doc.id} missing plaidTransactionId`);
          skippedCount++;
          continue;
        }

        // Get the original Plaid transaction data
        // In the unified sync, we use Plaid transaction ID as document ID
        const plaidTransaction = transaction;

        // Re-map category
        const oldCategory = transaction.category;
        const newCategory = await remapCategory(plaidTransaction);

        // Re-match budget period
        const transactionDate = transaction.date instanceof Timestamp
          ? transaction.date.toDate()
          : new Date(transaction.date);

        const {
          budgetId: newBudgetId,
          budgetPeriodId: newBudgetPeriodId,
          budgetName: newBudgetName
        } = await rematchBudgetPeriod(transaction.userId, transactionDate);

        // Check if anything changed
        const hasChanges =
          newCategory !== oldCategory ||
          newBudgetId !== transaction.budgetId ||
          newBudgetPeriodId !== (transaction.splits?.[0]?.budgetPeriodId || 'unassigned');

        if (hasChanges) {
          const updateData: any = {
            updatedAt: Timestamp.now()
          };

          const changeLog: any = {
            transactionId: doc.id,
            merchant: transaction.description,
            date: transactionDate.toISOString(),
            changes: {}
          };

          if (newCategory !== oldCategory) {
            updateData.category = newCategory;
            changeLog.changes.category = { from: oldCategory, to: newCategory };
          }

          if (newBudgetId !== transaction.budgetId) {
            updateData.budgetId = newBudgetId;
            updateData.primaryBudgetId = newBudgetId;
            changeLog.changes.budgetId = { from: transaction.budgetId, to: newBudgetId };
          }

          // Update split if budget period changed
          if (transaction.splits && transaction.splits.length > 0) {
            const updatedSplit = {
              ...transaction.splits[0],
              budgetId: newBudgetId || 'unassigned',
              budgetPeriodId: newBudgetPeriodId,
              budgetName: newBudgetName,
              categoryId: newCategory,
              updatedAt: Timestamp.now()
            };

            updateData.splits = [updatedSplit];
            updateData.affectedBudgets = newBudgetId ? [newBudgetId] : [];
            updateData.affectedBudgetPeriods = newBudgetPeriodId !== 'unassigned' ? [newBudgetPeriodId] : [];
            updateData.primaryBudgetPeriodId = newBudgetPeriodId !== 'unassigned' ? newBudgetPeriodId : undefined;

            changeLog.changes.split = {
              from: {
                budgetPeriodId: transaction.splits[0].budgetPeriodId,
                budgetName: transaction.splits[0].budgetName
              },
              to: {
                budgetPeriodId: newBudgetPeriodId,
                budgetName: newBudgetName
              }
            };
          }

          console.log(`${dryRun ? '[DRY RUN]' : ''} Updating transaction ${doc.id}:`, changeLog);

          if (!dryRun) {
            await doc.ref.update(updateData);
          }

          changes.push(changeLog);
          updatedCount++;
        } else {
          skippedCount++;
        }
      }

      const summary = {
        success: true,
        totalProcessed: snapshot.size,
        updatedCount,
        skippedCount,
        dryRun,
        changes: changes.slice(0, 10), // Return first 10 changes
        message: dryRun
          ? `Dry run complete. Would update ${updatedCount} transactions`
          : `Updated ${updatedCount} transactions, skipped ${skippedCount}`
      };

      console.log('✅ Reprocessing complete:', summary);

      return summary;

    } catch (error: any) {
      console.error('❌ Error reprocessing transactions:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to reprocess transactions');
    }
  }
);

/**
 * Re-map Plaid category to our transaction category
 */
async function remapCategory(transaction: any): Promise<TransactionCategory> {
  const plaidCategories = transaction.metadata?.plaidCategory || [];

  if (!plaidCategories || plaidCategories.length === 0) {
    return TransactionCategory.OTHER_EXPENSE;
  }

  const primaryCategory = plaidCategories[0].toLowerCase();
  const secondaryCategory = plaidCategories[1]?.toLowerCase() || '';

  // Map common Plaid categories to our categories
  const categoryMappings: Record<string, TransactionCategory> = {
    // Food & Dining
    'food and drink': TransactionCategory.FOOD,
    'restaurants': TransactionCategory.FOOD,
    'fast food': TransactionCategory.FOOD,
    'coffee shops': TransactionCategory.FOOD,
    'groceries': TransactionCategory.FOOD,

    // Transportation
    'transportation': TransactionCategory.TRANSPORTATION,
    'gas stations': TransactionCategory.TRANSPORTATION,
    'public transportation': TransactionCategory.TRANSPORTATION,
    'ride share': TransactionCategory.TRANSPORTATION,
    'parking': TransactionCategory.TRANSPORTATION,
    'airlines': TransactionCategory.TRANSPORTATION,

    // Shopping & Clothing
    'shops': TransactionCategory.CLOTHING,
    'retail': TransactionCategory.CLOTHING,
    'clothing': TransactionCategory.CLOTHING,
    'department stores': TransactionCategory.CLOTHING,

    // Entertainment
    'entertainment': TransactionCategory.ENTERTAINMENT,
    'movies': TransactionCategory.ENTERTAINMENT,
    'music': TransactionCategory.ENTERTAINMENT,
    'sports': TransactionCategory.ENTERTAINMENT,
    'recreation': TransactionCategory.ENTERTAINMENT,

    // Healthcare
    'healthcare': TransactionCategory.HEALTHCARE,
    'medical': TransactionCategory.HEALTHCARE,
    'pharmacy': TransactionCategory.HEALTHCARE,
    'dentist': TransactionCategory.HEALTHCARE,

    // Utilities
    'utilities': TransactionCategory.UTILITIES,
    'internet': TransactionCategory.UTILITIES,
    'phone': TransactionCategory.UTILITIES,
    'cable': TransactionCategory.UTILITIES,

    // Housing
    'rent': TransactionCategory.HOUSING,
    'mortgage': TransactionCategory.HOUSING,
    'home improvement': TransactionCategory.HOUSING,

    // Travel
    'travel': TransactionCategory.TRANSPORTATION,
    'hotels': TransactionCategory.HOUSING,

    // Income
    'payroll': TransactionCategory.SALARY,
    'deposit': TransactionCategory.OTHER_INCOME,
  };

  // Check primary category first
  if (categoryMappings[primaryCategory]) {
    return categoryMappings[primaryCategory];
  }

  // Check secondary category
  if (categoryMappings[secondaryCategory]) {
    return categoryMappings[secondaryCategory];
  }

  // Check if any category contains certain keywords
  const allCategories = plaidCategories.join(' ').toLowerCase();

  if (allCategories.includes('food') || allCategories.includes('restaurant') || allCategories.includes('grocery')) {
    return TransactionCategory.FOOD;
  }
  if (allCategories.includes('gas') || allCategories.includes('fuel') || allCategories.includes('transport') || allCategories.includes('airline')) {
    return TransactionCategory.TRANSPORTATION;
  }
  if (allCategories.includes('clothing') || allCategories.includes('apparel')) {
    return TransactionCategory.CLOTHING;
  }
  if (allCategories.includes('entertainment') || allCategories.includes('movie') || allCategories.includes('game')) {
    return TransactionCategory.ENTERTAINMENT;
  }

  // Default to OTHER_EXPENSE if no mapping found
  return TransactionCategory.OTHER_EXPENSE;
}

/**
 * Re-match transaction to budget period based on date
 */
async function rematchBudgetPeriod(
  userId: string,
  transactionDate: Date
): Promise<{
  budgetId: string | undefined;
  budgetPeriodId: string;
  budgetName: string;
}> {
  const transactionTimestamp = Timestamp.fromDate(transactionDate);

  // Query all active budget periods for the user
  const budgetPeriodsSnapshot = await db.collection('budget_periods')
    .where('userId', '==', userId)
    .where('isActive', '==', true)
    .get();

  console.log(`  Found ${budgetPeriodsSnapshot.size} active budget periods for user ${userId}`);

  // Filter to find budget period that contains the transaction date
  for (const doc of budgetPeriodsSnapshot.docs) {
    const period = doc.data();
    const periodStart = period.periodStartDate || period.periodStart;
    const periodEnd = period.periodEndDate || period.periodEnd;

    if (periodStart && periodEnd) {
      const startTimestamp = periodStart instanceof Timestamp ? periodStart : Timestamp.fromDate(new Date(periodStart));
      const endTimestamp = periodEnd instanceof Timestamp ? periodEnd : Timestamp.fromDate(new Date(periodEnd));

      // Check if transaction date falls within this period
      if (transactionTimestamp.toMillis() >= startTimestamp.toMillis() &&
          transactionTimestamp.toMillis() <= endTimestamp.toMillis()) {
        return {
          budgetId: period.budgetId,
          budgetPeriodId: doc.id,
          budgetName: period.budgetName || 'General'
        };
      }
    }
  }

  // No match found
  return {
    budgetId: undefined,
    budgetPeriodId: 'unassigned',
    budgetName: 'General'
  };
}
