/**
 * Update Outflow Periods Utility
 *
 * Updates all outflow periods when parent outflow changes.
 * Only updates future unpaid periods to preserve historical payment data.
 *
 * Handles three types of changes:
 * 1. averageAmount - Recalculates period amounts
 * 2. userCustomName - Updates period descriptions
 * 3. transactionIds - Re-runs auto-matching
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { Outflow, OutflowPeriod } from '../../../types';
import { autoMatchSinglePeriod } from './autoMatchSinglePeriod';

export interface OutflowUpdateResult {
  success: boolean;
  periodsQueried: number;
  periodsUpdated: number;
  periodsSkipped: number;
  fieldsUpdated: string[];
  errors: string[];
}

/**
 * Helper: Check if transactionIds array changed
 */
function hasTransactionIdsChanged(before: Outflow, after: Outflow): boolean {
  const beforeIds = before.transactionIds || [];
  const afterIds = after.transactionIds || [];

  // Quick length check
  if (beforeIds.length !== afterIds.length) {
    return true;
  }

  // Deep equality check
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);

  if (beforeSet.size !== afterSet.size) {
    return true;
  }

  for (const id of beforeSet) {
    if (!afterSet.has(id)) {
      return true;
    }
  }

  return false;
}

/**
 * Helper: Calculate number of days in a period
 */
function calculateDaysInPeriod(period: OutflowPeriod): number {
  const start = period.periodStartDate.toDate();
  const end = period.periodEndDate.toDate();
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Main function: Update all outflow periods when parent outflow changes
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow ID
 * @param outflowBefore - Outflow data before update
 * @param outflowAfter - Outflow data after update
 * @returns Result with update statistics
 */
export async function runUpdateOutflowPeriods(
  db: admin.firestore.Firestore,
  outflowId: string,
  outflowBefore: Outflow,
  outflowAfter: Outflow
): Promise<OutflowUpdateResult> {
  const result: OutflowUpdateResult = {
    success: false,
    periodsQueried: 0,
    periodsUpdated: 0,
    periodsSkipped: 0,
    fieldsUpdated: [],
    errors: []
  };

  try {
    console.log(`[runUpdateOutflowPeriods] Starting update for outflow: ${outflowId}`);

    // Step 1: Detect which fields changed
    const changedFields: string[] = [];

    if (outflowBefore.averageAmount !== outflowAfter.averageAmount) {
      changedFields.push('averageAmount');
      console.log(`[runUpdateOutflowPeriods] averageAmount changed: ${outflowBefore.averageAmount} → ${outflowAfter.averageAmount}`);
    }

    if (outflowBefore.userCustomName !== outflowAfter.userCustomName) {
      changedFields.push('userCustomName');
      console.log(`[runUpdateOutflowPeriods] userCustomName changed: "${outflowBefore.userCustomName}" → "${outflowAfter.userCustomName}"`);
    }

    if (hasTransactionIdsChanged(outflowBefore, outflowAfter)) {
      changedFields.push('transactionIds');
      const beforeCount = (outflowBefore.transactionIds || []).length;
      const afterCount = (outflowAfter.transactionIds || []).length;
      console.log(`[runUpdateOutflowPeriods] transactionIds changed: ${beforeCount} → ${afterCount} transactions`);
    }

    if (changedFields.length === 0) {
      console.log(`[runUpdateOutflowPeriods] No relevant changes detected, skipping update`);
      result.success = true;
      result.fieldsUpdated = [];
      return result;
    }

    result.fieldsUpdated = changedFields;
    console.log(`[runUpdateOutflowPeriods] Fields to update: ${changedFields.join(', ')}`);

    // Step 2: Query all periods for this outflow
    console.log(`[runUpdateOutflowPeriods] Querying periods for outflow: ${outflowId}`);
    const periodsSnapshot = await db.collection('outflow_periods')
      .where('outflowId', '==', outflowId)
      .get();

    result.periodsQueried = periodsSnapshot.size;
    console.log(`[runUpdateOutflowPeriods] Found ${result.periodsQueried} periods`);

    if (periodsSnapshot.empty) {
      console.log(`[runUpdateOutflowPeriods] No periods found for outflow ${outflowId}`);
      result.success = true;
      return result;
    }

    // Step 3: Separate periods into two groups
    // - allPeriods: For userCustomName changes (propagate to ALL periods including paid)
    // - unpaidPeriods: For amount changes (skip paid periods to preserve payment data)
    const allPeriods: admin.firestore.QueryDocumentSnapshot[] = periodsSnapshot.docs;
    const unpaidPeriods: admin.firestore.QueryDocumentSnapshot[] = [];
    let paidCount = 0;

    for (const periodDoc of periodsSnapshot.docs) {
      const period = periodDoc.data() as OutflowPeriod;

      // Check if period is paid/partially paid
      if (period.isPaid || period.isFullyPaid || period.isPartiallyPaid) {
        paidCount++;
        continue;
      }

      // Unpaid periods can receive amount updates
      unpaidPeriods.push(periodDoc);
    }

    console.log(`[runUpdateOutflowPeriods] All periods: ${allPeriods.length}`);
    console.log(`[runUpdateOutflowPeriods] Unpaid periods (for amount changes): ${unpaidPeriods.length}`);
    console.log(`[runUpdateOutflowPeriods] Paid periods (name-only updates): ${paidCount}`);

    // Determine which periods to update based on what changed
    // - userCustomName changes go to ALL periods
    // - averageAmount/transactionIds changes only go to unpaid periods
    const hasNameChange = changedFields.includes('userCustomName');

    // If name changed, include all periods (paid periods will only get name updates)
    const periodsToUpdate = hasNameChange ? allPeriods : unpaidPeriods;
    result.periodsSkipped = hasNameChange ? 0 : paidCount;

    console.log(`[runUpdateOutflowPeriods] Periods to update: ${periodsToUpdate.length}`);
    console.log(`[runUpdateOutflowPeriods] Update mode: ${hasNameChange ? 'ALL periods (name change)' : 'unpaid only (amount change)'}`);

    if (periodsToUpdate.length === 0) {
      console.log(`[runUpdateOutflowPeriods] No periods need updating`);
      result.success = true;
      return result;
    }

    // Step 4: Update periods in batches
    const batchSize = 500; // Firestore batch limit
    let updatedCount = 0;

    for (let i = 0; i < periodsToUpdate.length; i += batchSize) {
      const batch = db.batch();
      const batchPeriods = periodsToUpdate.slice(i, i + batchSize);

      for (const periodDoc of batchPeriods) {
        const period = periodDoc.data() as OutflowPeriod;
        const updates: any = {};

        // Handle averageAmount change
        if (changedFields.includes('averageAmount')) {
          const dailyRate = outflowAfter.averageAmount / period.cycleDays;
          const daysInPeriod = calculateDaysInPeriod(period);

          updates.averageAmount = outflowAfter.averageAmount;
          updates.amountWithheld = dailyRate * daysInPeriod;
          updates.expectedAmount = outflowAfter.averageAmount;
          updates.totalAmountDue = outflowAfter.averageAmount;
          updates.amountPerOccurrence = outflowAfter.averageAmount;
          updates.dailyWithholdingRate = dailyRate;

          console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating amounts`);
          console.log(`  - Daily rate: $${dailyRate.toFixed(2)}`);
          console.log(`  - Days in period: ${daysInPeriod}`);
          console.log(`  - Amount withheld: $${updates.amountWithheld.toFixed(2)}`);
        }

        // Handle userCustomName change
        if (changedFields.includes('userCustomName')) {
          // Update userCustomName field on the period (this is what the frontend reads)
          updates.userCustomName = outflowAfter.userCustomName || '';
          // Also update description for backwards compatibility
          updates.description = outflowAfter.userCustomName || outflowAfter.description;
          console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating userCustomName to "${updates.userCustomName}"`);
        }

        // Handle transactionIds change - call autoMatchSinglePeriod
        if (changedFields.includes('transactionIds')) {
          console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: running auto-match`);
          try {
            const matchResult = await autoMatchSinglePeriod(
              db,
              periodDoc.id,
              period,
              outflowAfter
            );
            console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: matched ${matchResult.transactionsMatched} transactions`);
            // autoMatchSinglePeriod updates the period directly, so we skip batch update for this period
            updatedCount++;
            continue;
          } catch (error: any) {
            console.error(`[runUpdateOutflowPeriods] Error auto-matching period ${periodDoc.id}:`, error);
            result.errors.push(`Auto-match error for period ${periodDoc.id}: ${error.message}`);
          }
        }

        // Apply updates via batch (if not already updated by autoMatch)
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = Timestamp.now();
          batch.update(periodDoc.ref, updates);
          updatedCount++;
        }
      }

      // Commit batch
      await batch.commit();
      console.log(`[runUpdateOutflowPeriods] Committed batch ${Math.floor(i / batchSize) + 1}`);
    }

    result.periodsUpdated = updatedCount;
    result.success = true;

    console.log(`[runUpdateOutflowPeriods] ✓ Update complete: ${updatedCount} periods updated`);

  } catch (error: any) {
    console.error(`[runUpdateOutflowPeriods] Error:`, error);
    result.errors.push(error.message || 'Unknown error');
  }

  return result;
}
