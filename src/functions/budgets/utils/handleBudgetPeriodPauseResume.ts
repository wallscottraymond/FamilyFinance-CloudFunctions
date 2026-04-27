/**
 * Handle Budget Period Pause/Resume
 *
 * When a budget period is paused (isActive = false):
 * 1. Reassign transaction splits to "Everything Else" budget
 * 2. Store original budgetId in split for restore
 * 3. Add allocation to Everything Else period
 *
 * When a budget period is resumed (isActive = true):
 * 1. Reclaim transaction splits that were originally from this budget
 * 2. Restore Everything Else allocation
 *
 * This only affects the specific budget period being toggled.
 */

import * as admin from 'firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { BudgetPeriodDocument } from '../../../types';

export interface PauseResumeResult {
  success: boolean;
  action: 'paused' | 'resumed' | 'skipped';
  message: string;
  splitsReassigned: number;
  amountRedistributed: number;
  error: string | null;
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
 * Find transactions with splits assigned to this budget that fall within the period
 */
async function findTransactionsForBudgetPeriod(
  db: admin.firestore.Firestore,
  budgetId: string,
  periodStart: Date,
  periodEnd: Date,
  userId: string
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  // Query transactions by user and date range
  const query = await db.collection('transactions')
    .where('userId', '==', userId)
    .where('date', '>=', Timestamp.fromDate(periodStart))
    .where('date', '<=', Timestamp.fromDate(periodEnd))
    .get();

  // Filter to only those with splits assigned to this budget
  return query.docs.filter(doc => {
    const data = doc.data();
    const splits = data.splits || [];
    return splits.some((split: any) => split.budgetId === budgetId);
  });
}

/**
 * Find transactions with splits that were paused from this budget
 */
async function findPausedTransactionsForBudgetPeriod(
  db: admin.firestore.Firestore,
  budgetId: string,
  periodStart: Date,
  periodEnd: Date,
  userId: string
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  // Query transactions by user and date range
  const query = await db.collection('transactions')
    .where('userId', '==', userId)
    .where('date', '>=', Timestamp.fromDate(periodStart))
    .where('date', '<=', Timestamp.fromDate(periodEnd))
    .get();

  // Filter to only those with splits that have pausedFromBudgetId matching this budget
  return query.docs.filter(doc => {
    const data = doc.data();
    const splits = data.splits || [];
    return splits.some((split: any) => split.pausedFromBudgetId === budgetId);
  });
}

/**
 * Handle pause/resume for a specific budget period
 */
export async function handleBudgetPeriodPauseResume(
  db: admin.firestore.Firestore,
  periodId: string,
  periodData: BudgetPeriodDocument,
  isPausing: boolean
): Promise<PauseResumeResult> {
  const result: PauseResumeResult = {
    success: false,
    action: 'skipped',
    message: '',
    splitsReassigned: 0,
    amountRedistributed: 0,
    error: null
  };

  try {
    const budgetId = periodData.budgetId;
    const userId = (periodData as any).userId || (periodData as any).createdBy;
    const periodStart = periodData.periodStart.toDate();
    const periodEnd = periodData.periodEnd.toDate();
    const allocatedAmount = periodData.allocatedAmount || 0;

    console.log(`[handleBudgetPeriodPauseResume] ${isPausing ? 'Pausing' : 'Resuming'} period ${periodId}`);
    console.log(`[handleBudgetPeriodPauseResume] Budget: ${budgetId}, User: ${userId}`);
    console.log(`[handleBudgetPeriodPauseResume] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

    // Find Everything Else budget
    const everythingElseBudget = await findEverythingElseBudget(db, userId);
    if (!everythingElseBudget) {
      result.error = 'Everything Else budget not found';
      console.error(`[handleBudgetPeriodPauseResume] ${result.error}`);
      return result;
    }

    const everythingElseBudgetId = everythingElseBudget.id;
    console.log(`[handleBudgetPeriodPauseResume] Found Everything Else budget: ${everythingElseBudgetId}`);

    // Find corresponding Everything Else period
    const everythingElsePeriod = await findCorrespondingEverythingElsePeriod(
      db,
      everythingElseBudgetId,
      (periodData as any).sourcePeriodId
    );

    if (!everythingElsePeriod) {
      result.error = 'Corresponding Everything Else period not found';
      console.error(`[handleBudgetPeriodPauseResume] ${result.error}`);
      return result;
    }

    console.log(`[handleBudgetPeriodPauseResume] Found Everything Else period: ${everythingElsePeriod.id}`);

    if (isPausing) {
      // PAUSING: Reassign splits to Everything Else
      const transactions = await findTransactionsForBudgetPeriod(
        db,
        budgetId,
        periodStart,
        periodEnd,
        userId
      );

      console.log(`[handleBudgetPeriodPauseResume] Found ${transactions.length} transactions with splits to reassign`);

      let totalAmountReassigned = 0;
      let splitsCount = 0;

      // Use batched writes for efficiency
      const batch = db.batch();

      for (const txnDoc of transactions) {
        const txnData = txnDoc.data();
        const splits = txnData.splits || [];
        let modified = false;

        const newSplits = splits.map((split: any) => {
          if (split.budgetId === budgetId) {
            totalAmountReassigned += split.amount || 0;
            splitsCount++;
            modified = true;
            return {
              ...split,
              budgetId: everythingElseBudgetId,
              pausedFromBudgetId: budgetId, // Track original for restore
              pausedAt: Timestamp.now()
            };
          }
          return split;
        });

        if (modified) {
          batch.update(txnDoc.ref, {
            splits: newSplits,
            updatedAt: Timestamp.now()
          });
        }
      }

      // Update budget periods - store paused amounts for restore
      const periodRef = db.collection('budget_periods').doc(periodId);
      batch.update(periodRef, {
        pausedSpent: periodData.spent || 0,
        pausedAllocatedAmount: allocatedAmount,
        updatedAt: Timestamp.now()
      });

      // Update Everything Else period allocation
      batch.update(everythingElsePeriod.ref, {
        allocatedAmount: FieldValue.increment(allocatedAmount),
        remaining: FieldValue.increment(allocatedAmount - totalAmountReassigned),
        spent: FieldValue.increment(totalAmountReassigned),
        updatedAt: Timestamp.now()
      });

      await batch.commit();

      result.success = true;
      result.action = 'paused';
      result.splitsReassigned = splitsCount;
      result.amountRedistributed = totalAmountReassigned;
      result.message = `Reassigned ${splitsCount} splits ($${totalAmountReassigned.toFixed(2)}) to Everything Else`;

    } else {
      // RESUMING: Reclaim splits from Everything Else
      const transactions = await findPausedTransactionsForBudgetPeriod(
        db,
        budgetId,
        periodStart,
        periodEnd,
        userId
      );

      console.log(`[handleBudgetPeriodPauseResume] Found ${transactions.length} transactions with paused splits to reclaim`);

      let totalAmountReclaimed = 0;
      let splitsCount = 0;

      const batch = db.batch();

      for (const txnDoc of transactions) {
        const txnData = txnDoc.data();
        const splits = txnData.splits || [];
        let modified = false;

        const newSplits = splits.map((split: any) => {
          if (split.pausedFromBudgetId === budgetId) {
            totalAmountReclaimed += split.amount || 0;
            splitsCount++;
            modified = true;
            // Remove pause tracking fields and restore original budgetId
            const { pausedFromBudgetId, pausedAt, ...rest } = split;
            return {
              ...rest,
              budgetId: budgetId // Restore original
            };
          }
          return split;
        });

        if (modified) {
          batch.update(txnDoc.ref, {
            splits: newSplits,
            updatedAt: Timestamp.now()
          });
        }
      }

      // Get paused amounts from period (stored when paused)
      const periodRef = db.collection('budget_periods').doc(periodId);
      const pausedAllocated = (periodData as any).pausedAllocatedAmount || allocatedAmount;

      // Clear paused fields from budget period
      batch.update(periodRef, {
        pausedSpent: FieldValue.delete(),
        pausedAllocatedAmount: FieldValue.delete(),
        updatedAt: Timestamp.now()
      });

      // Update Everything Else period - subtract the reclaimed amounts
      batch.update(everythingElsePeriod.ref, {
        allocatedAmount: FieldValue.increment(-pausedAllocated),
        remaining: FieldValue.increment(-(pausedAllocated - totalAmountReclaimed)),
        spent: FieldValue.increment(-totalAmountReclaimed),
        updatedAt: Timestamp.now()
      });

      await batch.commit();

      result.success = true;
      result.action = 'resumed';
      result.splitsReassigned = splitsCount;
      result.amountRedistributed = totalAmountReclaimed;
      result.message = `Reclaimed ${splitsCount} splits ($${totalAmountReclaimed.toFixed(2)}) from Everything Else`;
    }

    console.log(`[handleBudgetPeriodPauseResume] ✓ ${result.message}`);

  } catch (error: any) {
    console.error('[handleBudgetPeriodPauseResume] Error:', error);
    result.error = error.message || 'Unknown error';
  }

  return result;
}
