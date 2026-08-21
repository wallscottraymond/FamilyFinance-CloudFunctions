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
import { Outflow, OutflowPeriod } from '../../../../types';
import { autoMatchSinglePeriod } from './autoMatchSinglePeriod';
import { matchAllTransactionsToOccurrences } from './matchAllTransactionsToOccurrences';

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

    // The EFFECTIVE expected amount is the user's override when set, else Plaid's
    // average. A change to EITHER (edit the override, or Plaid refreshing the
    // average while no override is set) recomputes period amounts.
    const effectiveAmountBefore = outflowBefore.expectedAmountOverride ?? outflowBefore.averageAmount;
    const effectiveAmount = outflowAfter.expectedAmountOverride ?? outflowAfter.averageAmount;

    if (effectiveAmountBefore !== effectiveAmount) {
      changedFields.push('averageAmount');
      console.log(`[runUpdateOutflowPeriods] effective expected amount changed: ${effectiveAmountBefore} → ${effectiveAmount} (override=${outflowAfter.expectedAmountOverride ?? 'none'})`);
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

    // Check for description changes (separate from userCustomName)
    if (outflowBefore.description !== outflowAfter.description) {
      changedFields.push('description');
      console.log(`[runUpdateOutflowPeriods] description changed: "${outflowBefore.description}" → "${outflowAfter.description}"`);
    }

    // Check for merchantName changes
    if (outflowBefore.merchantName !== outflowAfter.merchantName) {
      changedFields.push('merchantName');
      console.log(`[runUpdateOutflowPeriods] merchantName changed: "${outflowBefore.merchantName}" → "${outflowAfter.merchantName}"`);
    }

    // Check for expenseType changes
    if (outflowBefore.expenseType !== outflowAfter.expenseType) {
      changedFields.push('expenseType');
      console.log(`[runUpdateOutflowPeriods] expenseType changed: "${outflowBefore.expenseType}" → "${outflowAfter.expenseType}"`);
    }

    // Check for isEssential changes
    if (outflowBefore.isEssential !== outflowAfter.isEssential) {
      changedFields.push('isEssential');
      console.log(`[runUpdateOutflowPeriods] isEssential changed: ${outflowBefore.isEssential} → ${outflowAfter.isEssential}`);
    }

    // Check for frequency changes
    if (outflowBefore.frequency !== outflowAfter.frequency) {
      changedFields.push('frequency');
      console.log(`[runUpdateOutflowPeriods] frequency changed: "${outflowBefore.frequency}" → "${outflowAfter.frequency}"`);
    }

    // Check for isActive changes
    if (outflowBefore.isActive !== outflowAfter.isActive) {
      changedFields.push('isActive');
      console.log(`[runUpdateOutflowPeriods] isActive changed: ${outflowBefore.isActive} → ${outflowAfter.isActive}`);
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

    // Determine which periods to update based on what changed.
    // EXPECTED-amount + name/metadata changes propagate to ALL periods — INCLUDING paid ones.
    // Rationale (locked 2026-08-21): the EXPECTED amount is what you *expect* the bill to be and
    // is independent of payment; only the ACTUAL paid amount (totalAmountPaid, occurrence.amountPaid)
    // is tied to the real transaction and is NEVER overwritten here. Previously amount changes were
    // gated to unpaid periods, so editing a bill whose current period was already paid silently did
    // nothing (the name — which always went to all periods — DID change), i.e. "name changes but
    // amount doesn't". The `transactionIds` auto-match below stays gated to unpaid periods.
    const periodsToUpdate = allPeriods;
    result.periodsSkipped = 0;

    console.log(`[runUpdateOutflowPeriods] Periods to update: ${periodsToUpdate.length} (all; ${paidCount} paid get EXPECTED-only updates, actual paid amounts preserved)`);

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

        // Handle averageAmount change (uses the EFFECTIVE amount: override ?? average)
        if (changedFields.includes('averageAmount')) {
          const dailyRate = effectiveAmount / period.cycleDays;
          const daysInPeriod = calculateDaysInPeriod(period);

          // EXPECTED fields — recomputed on every period (paid included).
          updates.averageAmount = effectiveAmount;
          updates.amountWithheld = dailyRate * daysInPeriod;
          updates.expectedAmount = effectiveAmount;
          updates.totalAmountDue = effectiveAmount;
          updates.amountPerOccurrence = effectiveAmount;
          updates.dailyWithholdingRate = dailyRate;
          // ACTUAL paid is tied to the transaction and is NOT touched here; only the
          // derived "unpaid = expected − paid" is recomputed (clamped at 0 when overpaid).
          updates.totalAmountUnpaid = Math.max(0, effectiveAmount - (period.totalAmountPaid || 0));

          // Update each occurrence's EXPECTED amountDue to the new amount, but PRESERVE its
          // ACTUAL payment facts (amountPaid, isPaid, paymentDate, transactionSplitId, …).
          if (period.occurrences && period.occurrences.length > 0) {
            updates.occurrences = period.occurrences.map(occ => ({ ...occ, amountDue: effectiveAmount }));
            const paidOcc = period.occurrences.filter(o => o.isPaid).length;
            console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: set amountDue=$${effectiveAmount.toFixed(2)} on ${period.occurrences.length} occurrence(s) (${paidOcc} paid — amountPaid preserved)`);
          }

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

        // Handle description change (when not overridden by userCustomName)
        if (changedFields.includes('description') && !changedFields.includes('userCustomName')) {
          // Only update description if userCustomName is not set
          if (!outflowAfter.userCustomName) {
            updates.description = outflowAfter.description || '';
            console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating description to "${updates.description}"`);
          }
        }

        // Handle merchantName change
        if (changedFields.includes('merchantName')) {
          updates.merchantName = outflowAfter.merchantName || null;
          console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating merchantName to "${updates.merchantName}"`);
        }

        // Handle expenseType change
        if (changedFields.includes('expenseType')) {
          updates.expenseType = outflowAfter.expenseType;
          console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating expenseType to "${updates.expenseType}"`);
        }

        // Handle isEssential change
        if (changedFields.includes('isEssential')) {
          updates.isEssential = outflowAfter.isEssential ?? false;
          console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating isEssential to ${updates.isEssential}`);
        }

        // Handle isActive change - only affects unpaid periods
        // Check if this is a paid period (skip isActive update for paid periods)
        const isPaid = period.isPaid || period.isFullyPaid || period.isPartiallyPaid;
        if (changedFields.includes('isActive') && !isPaid) {
          updates.isActive = outflowAfter.isActive ?? true;
          console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating isActive to ${updates.isActive}`);
        }

        // Handle transactionIds change - call autoMatchSinglePeriod.
        // Gated to UNPAID periods (now that we iterate ALL periods for expected-amount updates):
        // re-matching an already-paid period could double-assign, and its payment facts are settled.
        if (changedFields.includes('transactionIds') && !isPaid) {
          console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: running auto-match`);
          try {
            const matchResult = await autoMatchSinglePeriod(
              db,
              periodDoc.id,
              period,
              outflowAfter
            );
            console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: matched ${matchResult.transactionsMatched} transactions`);

            // After auto-matching, run occurrence matching if period has occurrences
            if (period.occurrenceDueDates && period.occurrenceDueDates.length > 0) {
              console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: running occurrence matching for ${period.occurrenceDueDates.length} occurrences...`);
              try {
                // Re-fetch period to get updated transactionSplits from auto-matching
                const updatedPeriodSnap = await db.collection('outflow_periods').doc(periodDoc.id).get();
                if (updatedPeriodSnap.exists) {
                  const updatedPeriodData = { id: updatedPeriodSnap.id, ...updatedPeriodSnap.data() } as OutflowPeriod;
                  await matchAllTransactionsToOccurrences(db, periodDoc.id, updatedPeriodData);
                  console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: ✓ occurrence matching complete`);
                }
              } catch (occurrenceError: any) {
                console.error(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: ⚠️  occurrence matching failed:`, occurrenceError);
                result.errors.push(`Occurrence matching error for period ${periodDoc.id}: ${occurrenceError.message}`);
              }
            }

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
