/**
 * Update Inflow Periods Utility
 *
 * Updates all inflow periods when parent inflow changes.
 * Only updates future unreceived periods to preserve historical income data.
 *
 * Handles three types of changes:
 * 1. averageAmount - Recalculates period amounts
 * 2. userCustomName - Updates period descriptions
 * 3. transactionIds - Re-runs transaction alignment
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { Inflow, InflowPeriod } from '../../../../types';
import { alignTransactionsToInflowPeriods } from './alignTransactionsToInflowPeriods';
import { predictNextPayment } from './predictNextPayment';

export interface InflowUpdateResult {
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
function hasTransactionIdsChanged(before: Partial<Inflow>, after: Partial<Inflow>): boolean {
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
function calculateDaysInPeriod(period: InflowPeriod): number {
  const start = period.periodStartDate.toDate();
  const end = period.periodEndDate.toDate();
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Main function: Update all inflow periods when parent inflow changes
 *
 * @param db - Firestore instance
 * @param inflowId - The inflow ID
 * @param inflowBefore - Inflow data before update
 * @param inflowAfter - Inflow data after update
 * @returns Result with update statistics
 */
export async function runUpdateInflowPeriods(
  db: admin.firestore.Firestore,
  inflowId: string,
  inflowBefore: Partial<Inflow>,
  inflowAfter: Partial<Inflow>
): Promise<InflowUpdateResult> {
  const result: InflowUpdateResult = {
    success: false,
    periodsQueried: 0,
    periodsUpdated: 0,
    periodsSkipped: 0,
    fieldsUpdated: [],
    errors: []
  };

  try {
    console.log(`[runUpdateInflowPeriods] Starting update for inflow: ${inflowId}`);

    // Step 1: Detect which fields changed
    const changedFields: string[] = [];

    if (inflowBefore.averageAmount !== inflowAfter.averageAmount) {
      changedFields.push('averageAmount');
      console.log(`[runUpdateInflowPeriods] averageAmount changed: ${inflowBefore.averageAmount} → ${inflowAfter.averageAmount}`);
    }

    if (inflowBefore.userCustomName !== inflowAfter.userCustomName) {
      changedFields.push('userCustomName');
      console.log(`[runUpdateInflowPeriods] userCustomName changed: "${inflowBefore.userCustomName}" → "${inflowAfter.userCustomName}"`);
    }

    if (hasTransactionIdsChanged(inflowBefore, inflowAfter)) {
      changedFields.push('transactionIds');
      const beforeCount = (inflowBefore.transactionIds || []).length;
      const afterCount = (inflowAfter.transactionIds || []).length;
      console.log(`[runUpdateInflowPeriods] transactionIds changed: ${beforeCount} → ${afterCount} transactions`);
    }

    // Check for predictedNextDate changes
    const beforePredicted = inflowBefore.predictedNextDate?.toMillis?.() ?? null;
    const afterPredicted = inflowAfter.predictedNextDate?.toMillis?.() ?? null;
    if (beforePredicted !== afterPredicted) {
      changedFields.push('predictedNextDate');
      console.log(`[runUpdateInflowPeriods] predictedNextDate changed`);
    }

    if (changedFields.length === 0) {
      console.log(`[runUpdateInflowPeriods] No relevant changes detected, skipping update`);
      result.success = true;
      result.fieldsUpdated = [];
      return result;
    }

    result.fieldsUpdated = changedFields;
    console.log(`[runUpdateInflowPeriods] Fields to update: ${changedFields.join(', ')}`);

    // Step 2: Query all periods for this inflow
    console.log(`[runUpdateInflowPeriods] Querying periods for inflow: ${inflowId}`);
    const periodsSnapshot = await db.collection('inflow_periods')
      .where('inflowId', '==', inflowId)
      .get();

    result.periodsQueried = periodsSnapshot.size;
    console.log(`[runUpdateInflowPeriods] Found ${result.periodsQueried} periods`);

    if (periodsSnapshot.empty) {
      console.log(`[runUpdateInflowPeriods] No periods found for inflow ${inflowId}`);
      result.success = true;
      return result;
    }

    // Step 3: Separate periods into two groups
    // - allPeriods: For userCustomName changes (propagate to ALL periods including received)
    // - unreceivedPeriods: For amount changes (skip received periods to preserve income data)
    const allPeriods: admin.firestore.QueryDocumentSnapshot[] = periodsSnapshot.docs;
    const unreceivedPeriods: admin.firestore.QueryDocumentSnapshot[] = [];
    let receivedCount = 0;

    for (const periodDoc of periodsSnapshot.docs) {
      const period = periodDoc.data() as InflowPeriod;

      // Check if period has received payments
      if (period.isPaid || period.isFullyPaid || period.isPartiallyPaid) {
        receivedCount++;
        continue;
      }

      // Unreceived periods can receive amount updates
      unreceivedPeriods.push(periodDoc);
    }

    console.log(`[runUpdateInflowPeriods] All periods: ${allPeriods.length}`);
    console.log(`[runUpdateInflowPeriods] Unreceived periods (for amount changes): ${unreceivedPeriods.length}`);
    console.log(`[runUpdateInflowPeriods] Received periods (name-only updates): ${receivedCount}`);

    // Determine which periods to update based on what changed
    // - userCustomName changes go to ALL periods
    // - averageAmount/transactionIds changes only go to unreceived periods
    const hasNameChange = changedFields.includes('userCustomName');

    // If name changed, include all periods (received periods will only get name updates)
    const periodsToUpdate = hasNameChange ? allPeriods : unreceivedPeriods;
    result.periodsSkipped = hasNameChange ? 0 : receivedCount;

    console.log(`[runUpdateInflowPeriods] Periods to update: ${periodsToUpdate.length}`);
    console.log(`[runUpdateInflowPeriods] Update mode: ${hasNameChange ? 'ALL periods (name change)' : 'unreceived only (amount change)'}`);

    if (periodsToUpdate.length === 0) {
      console.log(`[runUpdateInflowPeriods] No periods need updating`);
      result.success = true;
      return result;
    }

    // Step 4: If transactionIds changed, run alignment
    if (changedFields.includes('transactionIds')) {
      console.log(`[runUpdateInflowPeriods] Running transaction alignment for all periods`);
      try {
        const alignmentResult = await alignTransactionsToInflowPeriods(
          db,
          inflowId,
          inflowAfter,
          allPeriods.map(doc => doc.id)
        );
        console.log(`[runUpdateInflowPeriods] Transaction alignment complete:`, alignmentResult);
      } catch (alignError) {
        console.error(`[runUpdateInflowPeriods] Transaction alignment error:`, alignError);
        result.errors.push(`Transaction alignment error: ${alignError}`);
      }
    }

    // Step 5: Calculate updated prediction
    let predictionData: { expectedDate: Timestamp; expectedAmount: number } | null = null;
    if (changedFields.includes('predictedNextDate') || changedFields.includes('averageAmount')) {
      const prediction = predictNextPayment(inflowAfter);
      if (prediction) {
        predictionData = {
          expectedDate: prediction.expectedDate,
          expectedAmount: prediction.expectedAmount
        };
        console.log(`[runUpdateInflowPeriods] Updated prediction: ${prediction.expectedDate.toDate().toISOString()}, $${prediction.expectedAmount}`);
      }
    }

    // Step 6: Update periods in batches
    const batchSize = 500; // Firestore batch limit
    let updatedCount = 0;

    for (let i = 0; i < periodsToUpdate.length; i += batchSize) {
      const batch = db.batch();
      const batchPeriods = periodsToUpdate.slice(i, i + batchSize);

      for (const periodDoc of batchPeriods) {
        const period = periodDoc.data() as InflowPeriod;
        const updates: Record<string, any> = {};

        // Check if this period has received income (skip amount updates if so)
        const isReceived = period.isPaid || period.isFullyPaid || period.isPartiallyPaid;

        // Handle averageAmount change (only for unreceived periods)
        if (changedFields.includes('averageAmount') && !isReceived) {
          const incomeAmount = Math.abs(inflowAfter.averageAmount || 0);
          const daysInPeriod = calculateDaysInPeriod(period);
          const cycleDays = period.cycleDays || 30;
          const dailyRate = incomeAmount / cycleDays;

          updates.averageAmount = incomeAmount;
          updates.amountWithheld = dailyRate * daysInPeriod;
          updates.expectedAmount = incomeAmount * (period.numberOfOccurrencesInPeriod || 1);
          updates.totalAmountDue = incomeAmount * (period.numberOfOccurrencesInPeriod || 1);
          updates.amountPerOccurrence = incomeAmount;
          updates.dailyWithholdingRate = dailyRate;
          updates.totalAmountUnpaid = updates.totalAmountDue - (period.totalAmountPaid || 0);

          // Update occurrence amounts for unreceived occurrences
          if (period.occurrenceAmounts && period.occurrenceAmounts.length > 0) {
            updates.occurrenceAmounts = period.occurrenceAmounts.map((amt, idx) => {
              // Preserve received occurrence amounts, update unreceived ones
              const isPaidOccurrence = period.occurrencePaidFlags?.[idx] ?? false;
              return isPaidOccurrence ? amt : 0; // Reset unreceived to 0 (actual amount comes from transaction)
            });
          }

          console.log(`[runUpdateInflowPeriods] Period ${periodDoc.id}: updating amounts`);
          console.log(`  - Daily rate: $${dailyRate.toFixed(2)}`);
          console.log(`  - Days in period: ${daysInPeriod}`);
          console.log(`  - Amount withheld: $${updates.amountWithheld.toFixed(2)}`);
        }

        // Handle userCustomName change
        if (changedFields.includes('userCustomName')) {
          updates.userCustomName = inflowAfter.userCustomName || '';
          updates.description = inflowAfter.userCustomName || inflowAfter.description;
          console.log(`[runUpdateInflowPeriods] Period ${periodDoc.id}: updating userCustomName to "${updates.userCustomName}"`);
        }

        // Handle predictedNextDate change
        if (changedFields.includes('predictedNextDate') && predictionData) {
          updates.predictedNextDate = inflowAfter.predictedNextDate;
        }

        // Apply updates via batch (if there are any)
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = Timestamp.now();
          batch.update(periodDoc.ref, updates);
          updatedCount++;
        }
      }

      // Commit batch
      await batch.commit();
      console.log(`[runUpdateInflowPeriods] Committed batch ${Math.floor(i / batchSize) + 1}`);
    }

    result.periodsUpdated = updatedCount;
    result.success = true;

    console.log(`[runUpdateInflowPeriods] ✓ Update complete: ${updatedCount} periods updated`);

  } catch (error: any) {
    console.error(`[runUpdateInflowPeriods] Error:`, error);
    result.errors.push(error.message || 'Unknown error');
  }

  return result;
}
