/**
 * Budget Spending Update Utility
 *
 * Handles updating budget_periods spent amounts when transactions are created, updated, or deleted.
 *
 * Uses date-based period assignment: transactions are only applied to budget periods where
 * the transaction date falls within the period's start and end dates (inclusive).
 *
 * Also provides recalculation functionality when budgets are created to include historical transactions.
 */

import { db } from '../index';
import * as admin from 'firebase-admin';
import { Transaction, TransactionType, TransactionStatus, PeriodType, Budget } from '../types';

interface UpdateBudgetSpendingParams {
  oldTransaction?: Transaction;
  newTransaction?: Transaction;
  userId: string;
  familyId?: string;
}

interface BudgetSpendingResult {
  budgetPeriodsUpdated: number;
  budgetsAffected: string[];
  errors: string[];
  periodTypesUpdated: {
    weekly: number;
    bi_monthly: number;
    monthly: number;
  };
}

/**
 * Main entry point for updating budget spending based on transaction changes
 *
 * Updates only budget periods where the transaction date falls within the period's date range
 */
export async function updateBudgetSpending(
  params: UpdateBudgetSpendingParams
): Promise<BudgetSpendingResult> {
  const { oldTransaction, newTransaction, userId } = params;

  console.log('💰 updateBudgetSpending called:', {
    hasOld: !!oldTransaction,
    hasNew: !!newTransaction,
    userId,
    oldId: oldTransaction?.id,
    newId: newTransaction?.id
  });

  const result: BudgetSpendingResult = {
    budgetPeriodsUpdated: 0,
    budgetsAffected: [],
    errors: [],
    periodTypesUpdated: {
      weekly: 0,
      bi_monthly: 0,
      monthly: 0
    }
  };

  try {
    // Calculate spending deltas for each affected budget
    const deltas = calculateSpendingDeltas(oldTransaction, newTransaction);

    console.log('💰 Calculated deltas for budgets:',
      Object.fromEntries(deltas)
    );

    if (deltas.size === 0) {
      console.log('💰 No budget updates needed');
      return result;
    }

    // Get transaction date (use new transaction if available, otherwise old)
    const transaction = newTransaction || oldTransaction;
    const transactionDate = transaction?.date;

    if (!transactionDate) {
      console.warn('⚠️ No transaction date available, skipping budget updates');
      return result;
    }

    // Update each affected budget's periods
    for (const [budgetId, delta] of deltas) {
      if (budgetId === 'unassigned') {
        console.log('💰 Skipping unassigned budget');
        continue;
      }

      try {
        const updateResult = await updateBudgetPeriodSpending(
          budgetId,
          delta,
          userId,
          transactionDate
        );

        result.budgetPeriodsUpdated += updateResult.totalUpdated;
        result.periodTypesUpdated.weekly += updateResult.weeklyUpdated;
        result.periodTypesUpdated.bi_monthly += updateResult.biMonthlyUpdated;
        result.periodTypesUpdated.monthly += updateResult.monthlyUpdated;
        result.budgetsAffected.push(budgetId);

      } catch (error) {
        const errorMsg = `Failed to update budget ${budgetId}: ${error}`;
        console.error('❌', errorMsg);
        result.errors.push(errorMsg);
      }
    }

    console.log('✅ Budget spending update complete:', result);

    return result;

  } catch (error) {
    console.error('❌ Error in updateBudgetSpending:', error);
    result.errors.push(`Update failed: ${error}`);
    return result;
  }
}

/**
 * Extract budget spending amounts from a transaction's splits
 */
function getAffectedBudgets(transaction: Transaction): Map<string, number> {
  const budgetSpending = new Map<string, number>();

  // Only count approved expense transactions
  if (transaction.status !== TransactionStatus.APPROVED) {
    console.log('💰 Transaction not approved, skipping:', transaction.status);
    return budgetSpending;
  }

  if (transaction.type !== TransactionType.EXPENSE) {
    console.log('💰 Transaction not an expense, skipping:', transaction.type);
    return budgetSpending;
  }

  // Sum up spending by budget from splits
  for (const split of transaction.splits || []) {
    const budgetId = split.budgetId;
    const amount = split.amount;

    if (budgetId && budgetId !== 'unassigned') {
      const current = budgetSpending.get(budgetId) || 0;
      budgetSpending.set(budgetId, current + amount);

      console.log('💰 Split found:', {
        budgetId,
        budgetName: split.budgetName,
        splitAmount: amount,
        totalForBudget: current + amount
      });
    }
  }

  return budgetSpending;
}

/**
 * Calculate the delta (change) in spending for each budget
 */
function calculateSpendingDeltas(
  oldTransaction?: Transaction,
  newTransaction?: Transaction
): Map<string, number> {
  const oldSpending = oldTransaction ? getAffectedBudgets(oldTransaction) : new Map();
  const newSpending = newTransaction ? getAffectedBudgets(newTransaction) : new Map();

  const deltas = new Map<string, number>();

  // Get all affected budget IDs from both old and new
  const allBudgetIds = new Set([
    ...oldSpending.keys(),
    ...newSpending.keys()
  ]);

  // Calculate delta for each budget
  for (const budgetId of allBudgetIds) {
    const oldAmount = oldSpending.get(budgetId) || 0;
    const newAmount = newSpending.get(budgetId) || 0;
    const delta = newAmount - oldAmount;

    if (delta !== 0) {
      deltas.set(budgetId, delta);
      console.log('💰 Delta calculated:', {
        budgetId,
        oldAmount,
        newAmount,
        delta
      });
    }
  }

  return deltas;
}

interface PeriodUpdateResult {
  totalUpdated: number;
  weeklyUpdated: number;
  biMonthlyUpdated: number;
  monthlyUpdated: number;
}

/**
 * Update budget periods for a given budget, filtering by transaction date
 *
 * Only updates periods where the transaction date falls within the period's start and end dates (inclusive)
 */
async function updateBudgetPeriodSpending(
  budgetId: string,
  spendingDelta: number,
  userId: string,
  transactionDate: admin.firestore.Timestamp
): Promise<PeriodUpdateResult> {
  console.log(`📊 Updating spending for budget ${budgetId}, delta: ${spendingDelta}, transaction date: ${transactionDate.toDate().toISOString()}`);

  const result: PeriodUpdateResult = {
    totalUpdated: 0,
    weeklyUpdated: 0,
    biMonthlyUpdated: 0,
    monthlyUpdated: 0
  };

  // Query for ALL budget_periods of this budget (all period types)
  const budgetPeriods = await db.collection('budget_periods')
    .where('budgetId', '==', budgetId)
    .where('userId', '==', userId)
    .where('isActive', '==', true)
    .get();

  console.log(`📊 Found ${budgetPeriods.size} total budget periods for budget ${budgetId}`);

  if (budgetPeriods.empty) {
    console.warn(`⚠️ No budget periods found for budget ${budgetId}`);
    return result;
  }

  // Convert transaction date to milliseconds for comparison
  const transactionMs = transactionDate.toMillis();

  // Filter periods where transaction date falls within period date range
  const matchingPeriods: admin.firestore.DocumentSnapshot[] = [];

  budgetPeriods.forEach(periodDoc => {
    const periodData = periodDoc.data();
    const startDate = periodData.startDate as admin.firestore.Timestamp;
    const endDate = periodData.endDate as admin.firestore.Timestamp;

    if (!startDate || !endDate) {
      console.warn(`⚠️ Period ${periodDoc.id} missing startDate or endDate`);
      return;
    }

    const startMs = startDate.toMillis();
    const endMs = endDate.toMillis();

    // Check if transaction date is within period range (inclusive)
    if (transactionMs >= startMs && transactionMs <= endMs) {
      matchingPeriods.push(periodDoc);
      console.log(`✅ Transaction date matches period ${periodData.periodId} (${periodData.periodType}):`, {
        transactionDate: transactionDate.toDate().toISOString(),
        periodStart: startDate.toDate().toISOString(),
        periodEnd: endDate.toDate().toISOString()
      });
    }
  });

  console.log(`📊 Found ${matchingPeriods.length} periods matching transaction date`);

  if (matchingPeriods.length === 0) {
    console.warn(`⚠️ No budget periods found for transaction date ${transactionDate.toDate().toISOString()}`);
    return result;
  }

  // Update matching periods using batch writes
  const batch = db.batch();

  matchingPeriods.forEach(periodDoc => {
    const periodData = periodDoc.data();

    if (!periodData) {
      console.warn(`⚠️ Period ${periodDoc.id} has no data`);
      return;
    }

    const currentSpent = periodData.spent || 0;
    const allocatedAmount = periodData.modifiedAmount || periodData.allocatedAmount || 0;

    // Calculate new values
    const newSpent = currentSpent + spendingDelta;
    const newRemaining = allocatedAmount - newSpent;

    console.log(`📊 Updating budget_period ${periodDoc.id}:`, {
      periodType: periodData.periodType,
      periodId: periodData.periodId,
      budgetName: periodData.budgetName,
      oldSpent: currentSpent,
      delta: spendingDelta,
      newSpent: newSpent,
      allocated: allocatedAmount,
      newRemaining: newRemaining
    });

    batch.update(periodDoc.ref, {
      spent: newSpent,
      remaining: newRemaining,
      updatedAt: admin.firestore.Timestamp.now()
    });

    // Track counts by period type
    const periodType = periodData.periodType as PeriodType;
    if (periodType === PeriodType.WEEKLY) {
      result.weeklyUpdated++;
    } else if (periodType === PeriodType.BI_MONTHLY) {
      result.biMonthlyUpdated++;
    } else if (periodType === PeriodType.MONTHLY) {
      result.monthlyUpdated++;
    }

    result.totalUpdated++;
  });

  await batch.commit();

  console.log(`✅ Updated ${matchingPeriods.length} budget periods for budget ${budgetId}:`, result);

  return result;
}

/**
 * Recalculate budget spending when a new budget is created
 *
 * Finds ALL existing approved expense transactions that match the budget's categories
 * and assigns spending to budget periods based on transaction dates.
 * Each transaction is only applied to periods where the transaction date falls within the period's date range.
 */
export async function recalculateBudgetSpendingOnCreate(
  budgetId: string,
  budget: Budget
): Promise<{
  transactionsProcessed: number;
  totalSpending: number;
  budgetPeriodsUpdated: number;
  periodTypesUpdated: {
    weekly: number;
    bi_monthly: number;
    monthly: number;
  };
  errors: string[];
}> {
  console.log(`🔄 Recalculating spending for newly created budget: ${budgetId}`);
  console.log(`🔄 Budget categories:`, budget.categoryIds);

  const result = {
    transactionsProcessed: 0,
    totalSpending: 0,
    budgetPeriodsUpdated: 0,
    periodTypesUpdated: {
      weekly: 0,
      bi_monthly: 0,
      monthly: 0
    },
    errors: [] as string[]
  };

  try {
    // Find ALL approved expense transactions that match ANY of the budget's categories
    const transactionsSnapshot = await db.collection('transactions')
      .where('userId', '==', budget.createdBy)
      .where('status', '==', TransactionStatus.APPROVED)
      .where('type', '==', TransactionType.EXPENSE)
      .get();

    console.log(`🔄 Found ${transactionsSnapshot.size} total approved expense transactions for user`);

    // Get ALL budget periods for this budget
    const budgetPeriodsSnapshot = await db.collection('budget_periods')
      .where('budgetId', '==', budgetId)
      .where('userId', '==', budget.createdBy)
      .where('isActive', '==', true)
      .get();

    console.log(`🔄 Found ${budgetPeriodsSnapshot.size} budget periods`);

    if (budgetPeriodsSnapshot.empty) {
      console.warn(`⚠️ No budget periods found for budget ${budgetId}`);
      return result;
    }

    // Build a map of period spending: periodDocId -> spending amount
    const periodSpending = new Map<string, number>();

    // Initialize all periods to 0 spending
    budgetPeriodsSnapshot.forEach(periodDoc => {
      periodSpending.set(periodDoc.id, 0);
    });

    // Process each transaction
    let totalSpending = 0;

    transactionsSnapshot.forEach(doc => {
      const transaction = { id: doc.id, ...doc.data() } as Transaction;

      // Check if any split's category matches budget categories
      const matchingSplits = (transaction.splits || []).filter(split =>
        budget.categoryIds.includes(split.categoryId)
      );

      if (matchingSplits.length === 0) {
        return; // Skip this transaction
      }

      // Sum up spending from matching splits
      const transactionSpending = matchingSplits.reduce((sum, split) => sum + split.amount, 0);
      totalSpending += transactionSpending;
      result.transactionsProcessed++;

      const transactionDate = transaction.date as admin.firestore.Timestamp;
      const transactionMs = transactionDate.toMillis();

      console.log(`🔄 Processing transaction ${transaction.id}:`, {
        description: transaction.description,
        date: transactionDate.toDate().toISOString(),
        matchingSplits: matchingSplits.length,
        spending: transactionSpending
      });

      // Find matching periods for this transaction date
      budgetPeriodsSnapshot.forEach(periodDoc => {
        const periodData = periodDoc.data();
        const startDate = periodData.startDate as admin.firestore.Timestamp;
        const endDate = periodData.endDate as admin.firestore.Timestamp;

        if (!startDate || !endDate) {
          return;
        }

        const startMs = startDate.toMillis();
        const endMs = endDate.toMillis();

        // Check if transaction date is within period range (inclusive)
        if (transactionMs >= startMs && transactionMs <= endMs) {
          const currentSpending = periodSpending.get(periodDoc.id) || 0;
          periodSpending.set(periodDoc.id, currentSpending + transactionSpending);

          console.log(`  ✅ Assigned to period ${periodData.periodId} (${periodData.periodType})`);
        }
      });
    });

    console.log(`🔄 Total transactions processed: ${result.transactionsProcessed}`);
    console.log(`🔄 Total spending: ${totalSpending}`);

    result.totalSpending = totalSpending;

    // Update budget periods with calculated spending
    const batch = db.batch();
    const updatedPeriodIds = new Set<string>();

    budgetPeriodsSnapshot.forEach(periodDoc => {
      const periodData = periodDoc.data();
      const spending = periodSpending.get(periodDoc.id) || 0;

      // Only update if there's spending for this period
      if (spending > 0) {
        const allocatedAmount = periodData.modifiedAmount || periodData.allocatedAmount || 0;
        const newRemaining = allocatedAmount - spending;

        console.log(`🔄 Updating budget_period ${periodDoc.id}:`, {
          periodType: periodData.periodType,
          periodId: periodData.periodId,
          budgetName: periodData.budgetName,
          spent: spending,
          allocated: allocatedAmount,
          remaining: newRemaining
        });

        batch.update(periodDoc.ref, {
          spent: spending,
          remaining: newRemaining,
          updatedAt: admin.firestore.Timestamp.now()
        });

        updatedPeriodIds.add(periodDoc.id);

        // Track counts by period type
        const periodType = periodData.periodType as PeriodType;
        if (periodType === PeriodType.WEEKLY) {
          result.periodTypesUpdated.weekly++;
        } else if (periodType === PeriodType.BI_MONTHLY) {
          result.periodTypesUpdated.bi_monthly++;
        } else if (periodType === PeriodType.MONTHLY) {
          result.periodTypesUpdated.monthly++;
        }

        result.budgetPeriodsUpdated++;
      }
    });

    if (updatedPeriodIds.size > 0) {
      await batch.commit();
    }

    console.log(`✅ Recalculation complete for budget ${budgetId}:`, result);

    return result;

  } catch (error) {
    console.error(`❌ Error recalculating budget spending for ${budgetId}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(`Recalculation failed: ${errorMessage}`);
    return result;
  }
}
