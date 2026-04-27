/**
 * Redistribute Budget Allocation Utility
 *
 * Handles allocation redistribution when a budget is paused (isActive=false).
 * When a budget is paused, its current period's allocation is redistributed
 * to the "Everything Else" budget's corresponding period.
 *
 * When a budget is resumed (isActive=true), the allocation is reclaimed
 * from Everything Else and restored to the budget.
 *
 * This only affects the CURRENT period - future periods auto-resume.
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { BudgetPeriodDocument } from '../../../types';

export interface RedistributionResult {
  success: boolean;
  action: 'paused' | 'resumed' | 'none';
  budgetPeriodId: string | null;
  everythingElsePeriodId: string | null;
  amountRedistributed: number;
  error: string | null;
}

/**
 * Get today's date at midnight UTC for period comparison
 */
function getTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Check if today falls within a period (periodStart <= today <= periodEnd)
 */
function isCurrentPeriod(period: BudgetPeriodDocument): boolean {
  const today = getTodayUTC();
  const periodStart = period.periodStart.toDate();
  const periodEnd = period.periodEnd.toDate();
  return periodStart <= today && today <= periodEnd;
}

/**
 * Find the Everything Else budget for a user
 */
async function findEverythingElseBudget(
  db: admin.firestore.Firestore,
  userId: string
): Promise<admin.firestore.DocumentSnapshot | null> {
  const query = await db.collection('budgets')
    .where('userId', '==', userId)
    .where('isSystemEverythingElse', '==', true)
    .limit(1)
    .get();

  return query.empty ? null : query.docs[0];
}

/**
 * Find the current MONTHLY period for a budget
 * We use monthly periods for redistribution since that's the primary tracking period
 */
async function findCurrentBudgetPeriod(
  db: admin.firestore.Firestore,
  budgetId: string
): Promise<admin.firestore.QueryDocumentSnapshot | null> {
  const today = Timestamp.fromDate(getTodayUTC());

  // Query for periods where today falls within the range
  // We filter to monthly periods for consistency
  const periodsQuery = await db.collection('budget_periods')
    .where('budgetId', '==', budgetId)
    .where('periodType', '==', 'monthly')
    .where('periodStart', '<=', today)
    .get();

  // Find the period where periodEnd >= today
  for (const doc of periodsQuery.docs) {
    const period = doc.data() as BudgetPeriodDocument;
    if (isCurrentPeriod(period)) {
      return doc;
    }
  }

  return null;
}

/**
 * Find corresponding Everything Else period for the same source period
 */
async function findCorrespondingEverythingElsePeriod(
  db: admin.firestore.Firestore,
  everythingElseBudgetId: string,
  sourcePeriodId: string
): Promise<admin.firestore.QueryDocumentSnapshot | null> {
  const query = await db.collection('budget_periods')
    .where('budgetId', '==', everythingElseBudgetId)
    .where('sourcePeriodId', '==', sourcePeriodId)
    .limit(1)
    .get();

  return query.empty ? null : query.docs[0];
}

/**
 * Redistribute budget allocation when pausing/resuming a budget
 *
 * @param db - Firestore instance
 * @param budgetId - The budget being paused/resumed
 * @param userId - The user who owns the budget
 * @param isPausing - true if pausing (isActive going false), false if resuming
 * @returns Result of the redistribution operation
 */
export async function redistributeBudgetAllocation(
  db: admin.firestore.Firestore,
  budgetId: string,
  userId: string,
  isPausing: boolean
): Promise<RedistributionResult> {
  const result: RedistributionResult = {
    success: false,
    action: 'none',
    budgetPeriodId: null,
    everythingElsePeriodId: null,
    amountRedistributed: 0,
    error: null
  };

  try {
    console.log(`[redistributeBudgetAllocation] Starting ${isPausing ? 'pause' : 'resume'} for budget: ${budgetId}`);

    // Step 1: Find the Everything Else budget
    const everythingElseBudget = await findEverythingElseBudget(db, userId);
    if (!everythingElseBudget) {
      result.error = 'Everything Else budget not found for user';
      console.error(`[redistributeBudgetAllocation] ${result.error}`);
      return result;
    }

    const everythingElseBudgetId = everythingElseBudget.id;
    console.log(`[redistributeBudgetAllocation] Found Everything Else budget: ${everythingElseBudgetId}`);

    // Step 2: Find the current period for the paused/resumed budget
    const currentBudgetPeriod = await findCurrentBudgetPeriod(db, budgetId);
    if (!currentBudgetPeriod) {
      result.error = 'No current period found for budget';
      console.error(`[redistributeBudgetAllocation] ${result.error}`);
      return result;
    }

    const budgetPeriodData = currentBudgetPeriod.data() as BudgetPeriodDocument;
    result.budgetPeriodId = currentBudgetPeriod.id;
    console.log(`[redistributeBudgetAllocation] Found current budget period: ${currentBudgetPeriod.id}`);

    // Step 3: Find the corresponding Everything Else period
    const everythingElsePeriod = await findCorrespondingEverythingElsePeriod(
      db,
      everythingElseBudgetId,
      budgetPeriodData.sourcePeriodId
    );
    if (!everythingElsePeriod) {
      result.error = 'Corresponding Everything Else period not found';
      console.error(`[redistributeBudgetAllocation] ${result.error}`);
      return result;
    }

    const everythingElsePeriodData = everythingElsePeriod.data() as BudgetPeriodDocument;
    result.everythingElsePeriodId = everythingElsePeriod.id;
    console.log(`[redistributeBudgetAllocation] Found Everything Else period: ${everythingElsePeriod.id}`);

    // Step 4: Calculate redistribution amount
    const redistributionAmount = budgetPeriodData.allocatedAmount || 0;
    result.amountRedistributed = redistributionAmount;

    if (redistributionAmount === 0) {
      console.log(`[redistributeBudgetAllocation] No allocation to redistribute (amount is 0)`);
      result.success = true;
      result.action = 'none';
      return result;
    }

    // Step 5: Perform the redistribution in a transaction
    await db.runTransaction(async (transaction) => {
      const now = Timestamp.now();

      if (isPausing) {
        // PAUSING: Set budget period inactive, add allocation to Everything Else
        console.log(`[redistributeBudgetAllocation] Pausing budget period, redistributing $${redistributionAmount.toFixed(2)} to Everything Else`);

        // Update budget period: set inactive, zero out allocated amount
        transaction.update(currentBudgetPeriod.ref, {
          isActive: false,
          pausedAllocatedAmount: redistributionAmount, // Store original for resume
          allocatedAmount: 0,
          originalAmount: budgetPeriodData.originalAmount, // Keep original for reference
          remaining: -(budgetPeriodData.spent || 0), // Remaining is now negative of spent
          updatedAt: now,
          lastCalculated: now
        });

        // Update Everything Else period: add the redistributed amount
        const newEverythingElseAllocated = (everythingElsePeriodData.allocatedAmount || 0) + redistributionAmount;
        const newEverythingElseRemaining = newEverythingElseAllocated - (everythingElsePeriodData.spent || 0);

        transaction.update(everythingElsePeriod.ref, {
          allocatedAmount: newEverythingElseAllocated,
          remaining: newEverythingElseRemaining,
          updatedAt: now,
          lastCalculated: now
        });

        result.action = 'paused';
      } else {
        // RESUMING: Set budget period active, reclaim allocation from Everything Else
        const pausedAmount = budgetPeriodData.pausedAllocatedAmount || budgetPeriodData.originalAmount || 0;
        console.log(`[redistributeBudgetAllocation] Resuming budget period, reclaiming $${pausedAmount.toFixed(2)} from Everything Else`);

        // Update budget period: set active, restore allocated amount
        transaction.update(currentBudgetPeriod.ref, {
          isActive: true,
          allocatedAmount: pausedAmount,
          pausedAllocatedAmount: null, // Clear the paused amount field
          remaining: pausedAmount - (budgetPeriodData.spent || 0),
          updatedAt: now,
          lastCalculated: now
        });

        // Update Everything Else period: subtract the reclaimed amount
        const newEverythingElseAllocated = Math.max(0, (everythingElsePeriodData.allocatedAmount || 0) - pausedAmount);
        const newEverythingElseRemaining = newEverythingElseAllocated - (everythingElsePeriodData.spent || 0);

        transaction.update(everythingElsePeriod.ref, {
          allocatedAmount: newEverythingElseAllocated,
          remaining: newEverythingElseRemaining,
          updatedAt: now,
          lastCalculated: now
        });

        result.action = 'resumed';
        result.amountRedistributed = pausedAmount;
      }
    });

    result.success = true;
    console.log(`[redistributeBudgetAllocation] ✓ ${result.action}: Redistributed $${result.amountRedistributed.toFixed(2)}`);

  } catch (error: any) {
    console.error(`[redistributeBudgetAllocation] Error:`, error);
    result.error = error.message || 'Unknown error';
  }

  return result;
}
