/**
 * Update Budget Periods Utility
 *
 * Updates budget periods when parent budget changes.
 * Cascades field changes to current + future periods, preserving historical data.
 *
 * Handles the following field changes:
 * 1. name → Updates budgetName on current + future periods
 * 2. description → (Currently not stored on periods, but logged for future use)
 * 3. amount → Recalculates allocatedAmount on current + future periods
 * 4. alertThreshold → (Currently not stored on periods, but logged for future use)
 * 5. categoryIds → Handled separately by reassignTransactionsForBudget()
 *
 * Update Strategy:
 * - "Current + future" means: periods where periodEnd >= today
 * - Historical periods (periodEnd < today) are preserved
 * - Follows the same pattern as runUpdateInflowPeriods/runUpdateOutflowPeriods
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { Budget, BudgetPeriodDocument, PeriodType } from '../../../types';
import { calculatePeriodAllocatedAmount } from './calculatePeriodAllocatedAmount';

export interface BudgetUpdateResult {
  success: boolean;
  periodsQueried: number;
  periodsUpdated: number;
  periodsSkipped: number;
  fieldsUpdated: string[];
  errors: string[];
}

/**
 * Get today's date at midnight UTC for period comparison
 */
function getTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Check if a period is current or future (should receive updates)
 * Current + future = periodEnd >= today
 */
function isCurrentOrFuturePeriod(period: BudgetPeriodDocument): boolean {
  const today = getTodayUTC();
  const periodEnd = period.periodEnd.toDate();
  return periodEnd >= today;
}

/**
 * Get source period from cache or fetch
 */
async function getSourcePeriod(
  db: admin.firestore.Firestore,
  sourcePeriodId: string,
  cache: Map<string, admin.firestore.DocumentData>
): Promise<admin.firestore.DocumentData | null> {
  if (cache.has(sourcePeriodId)) {
    return cache.get(sourcePeriodId)!;
  }

  const doc = await db.collection('source_periods').doc(sourcePeriodId).get();
  if (doc.exists) {
    const data = { id: doc.id, ...doc.data() };
    cache.set(sourcePeriodId, data);
    return data;
  }
  return null;
}

/**
 * Main function: Update all budget periods when parent budget changes
 *
 * @param db - Firestore instance
 * @param budgetId - The budget ID
 * @param budgetBefore - Budget data before update
 * @param budgetAfter - Budget data after update
 * @returns Result with update statistics
 */
export async function runUpdateBudgetPeriods(
  db: admin.firestore.Firestore,
  budgetId: string,
  budgetBefore: Budget,
  budgetAfter: Budget
): Promise<BudgetUpdateResult> {
  const result: BudgetUpdateResult = {
    success: false,
    periodsQueried: 0,
    periodsUpdated: 0,
    periodsSkipped: 0,
    fieldsUpdated: [],
    errors: []
  };

  try {
    console.log(`[runUpdateBudgetPeriods] Starting update for budget: ${budgetId}`);

    // Step 1: Detect which fields changed
    const changedFields: string[] = [];

    if (budgetBefore.name !== budgetAfter.name) {
      changedFields.push('name');
      console.log(`[runUpdateBudgetPeriods] name changed: "${budgetBefore.name}" → "${budgetAfter.name}"`);
    }

    if (budgetBefore.description !== budgetAfter.description) {
      changedFields.push('description');
      console.log(`[runUpdateBudgetPeriods] description changed: "${budgetBefore.description}" → "${budgetAfter.description}"`);
    }

    if (budgetBefore.amount !== budgetAfter.amount) {
      changedFields.push('amount');
      console.log(`[runUpdateBudgetPeriods] amount changed: $${budgetBefore.amount} → $${budgetAfter.amount}`);
    }

    if (budgetBefore.alertThreshold !== budgetAfter.alertThreshold) {
      changedFields.push('alertThreshold');
      console.log(`[runUpdateBudgetPeriods] alertThreshold changed: ${budgetBefore.alertThreshold}% → ${budgetAfter.alertThreshold}%`);
    }

    // Note: categoryIds is handled separately by onBudgetUpdatedReassignTransactions
    // We skip it here to avoid duplicate processing

    if (changedFields.length === 0) {
      console.log(`[runUpdateBudgetPeriods] No relevant changes detected, skipping update`);
      result.success = true;
      result.fieldsUpdated = [];
      return result;
    }

    result.fieldsUpdated = changedFields;
    console.log(`[runUpdateBudgetPeriods] Fields to update: ${changedFields.join(', ')}`);

    // Step 2: Query all periods for this budget
    console.log(`[runUpdateBudgetPeriods] Querying periods for budget: ${budgetId}`);
    const periodsSnapshot = await db.collection('budget_periods')
      .where('budgetId', '==', budgetId)
      .get();

    result.periodsQueried = periodsSnapshot.size;
    console.log(`[runUpdateBudgetPeriods] Found ${result.periodsQueried} periods`);

    if (periodsSnapshot.empty) {
      console.log(`[runUpdateBudgetPeriods] No periods found for budget ${budgetId}`);
      result.success = true;
      return result;
    }

    // Step 3: Filter to current + future periods
    const currentAndFuturePeriods: admin.firestore.QueryDocumentSnapshot[] = [];
    let historicalCount = 0;

    for (const periodDoc of periodsSnapshot.docs) {
      const period = periodDoc.data() as BudgetPeriodDocument;

      if (isCurrentOrFuturePeriod(period)) {
        currentAndFuturePeriods.push(periodDoc);
      } else {
        historicalCount++;
      }
    }

    result.periodsSkipped = historicalCount;
    console.log(`[runUpdateBudgetPeriods] Current + future periods: ${currentAndFuturePeriods.length}`);
    console.log(`[runUpdateBudgetPeriods] Historical periods (skipped): ${historicalCount}`);

    if (currentAndFuturePeriods.length === 0) {
      console.log(`[runUpdateBudgetPeriods] No current/future periods to update`);
      result.success = true;
      return result;
    }

    // Step 4: Update periods in batches
    const batchSize = 500; // Firestore batch limit
    let updatedCount = 0;
    const sourcePeriodCache = new Map<string, admin.firestore.DocumentData>();

    // Get budget period type for amount calculation
    const budgetPeriodType = budgetAfter.period === 'monthly' ? PeriodType.MONTHLY :
                             budgetAfter.period === 'weekly' ? PeriodType.WEEKLY :
                             PeriodType.MONTHLY;

    for (let i = 0; i < currentAndFuturePeriods.length; i += batchSize) {
      const batch = db.batch();
      const batchPeriods = currentAndFuturePeriods.slice(i, i + batchSize);

      for (const periodDoc of batchPeriods) {
        const period = periodDoc.data() as BudgetPeriodDocument;
        const updates: Record<string, any> = {};

        // Handle name change
        if (changedFields.includes('name')) {
          updates.budgetName = budgetAfter.name;
          console.log(`[runUpdateBudgetPeriods] Period ${periodDoc.id}: updating budgetName to "${budgetAfter.name}"`);
        }

        // Handle amount change - recalculate allocatedAmount
        if (changedFields.includes('amount')) {
          // Get source period to calculate allocated amount
          const sourcePeriod = await getSourcePeriod(db, period.sourcePeriodId, sourcePeriodCache);

          if (sourcePeriod) {
            const newAllocatedAmount = calculatePeriodAllocatedAmount(
              budgetAfter.amount,
              budgetPeriodType,
              sourcePeriod as any
            );

            updates.allocatedAmount = newAllocatedAmount;
            updates.originalAmount = newAllocatedAmount;

            // Recalculate remaining if spent exists
            if (period.spent !== undefined) {
              updates.remaining = newAllocatedAmount - period.spent;
            }

            console.log(`[runUpdateBudgetPeriods] Period ${periodDoc.id}: updating allocatedAmount to $${newAllocatedAmount.toFixed(2)}`);
          } else {
            console.warn(`[runUpdateBudgetPeriods] Period ${periodDoc.id}: source period ${period.sourcePeriodId} not found, skipping amount update`);
            result.errors.push(`Source period not found for ${periodDoc.id}`);
          }
        }

        // Note: description and alertThreshold are not currently stored on budget_periods
        // If they need to be added in the future, handle them here

        // Apply updates via batch (if there are any)
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = Timestamp.now();
          updates.lastCalculated = Timestamp.now();
          batch.update(periodDoc.ref, updates);
          updatedCount++;
        }
      }

      // Commit batch
      await batch.commit();
      console.log(`[runUpdateBudgetPeriods] Committed batch ${Math.floor(i / batchSize) + 1}`);
    }

    result.periodsUpdated = updatedCount;
    result.success = true;

    console.log(`[runUpdateBudgetPeriods] ✓ Update complete: ${updatedCount} periods updated`);

  } catch (error: any) {
    console.error(`[runUpdateBudgetPeriods] Error:`, error);
    result.errors.push(error.message || 'Unknown error');
  }

  return result;
}
