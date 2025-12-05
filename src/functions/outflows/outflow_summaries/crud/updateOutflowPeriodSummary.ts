/**
 * Update Outflow Period Summary
 *
 * Updates user_summaries document when an outflow period is updated.
 * Called from onOutflowPeriodUpdate trigger.
 *
 * Per-user design: Each user has separate summary documents, so updates
 * won't block each other even under heavy concurrent load.
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  OutflowPeriod,
  Outflow,
  OutflowEntry,
  OutflowPeriodStatus
} from '../../../../types';
import { determinePeriodType } from '../utils/periodTypeHelpers';

/**
 * Update a single outflow entry in the user's summary document
 *
 * @param periodData - The updated outflow period data
 */
export async function updateOutflowPeriodSummary(
  periodData: OutflowPeriod
): Promise<void> {
  console.log('[updateOutflowPeriodSummary] Updating summary for period:', periodData.id);

  try {
    const db = admin.firestore();

    // Step 1: Determine period type from sourcePeriodId
    const periodType = determinePeriodType(periodData.sourcePeriodId);

    // Step 2: Build document ID for user_summaries
    // Format: {userId}_{periodType}_{sourcePeriodId}
    const summaryId = `${periodData.ownerId}_${periodType.toLowerCase()}_${periodData.sourcePeriodId}`;
    console.log(`[updateOutflowPeriodSummary] Target document: ${summaryId}`);

    // Step 3: Fetch parent outflow for merchant/userCustomName (outside transaction)
    const outflowDoc = await db.collection('outflows').doc(periodData.outflowId).get();

    if (!outflowDoc.exists) {
      console.warn(`[updateOutflowPeriodSummary] ⚠️  Outflow ${periodData.outflowId} not found, skipping`);
      return; // Don't fail the trigger, just skip summary update
    }

    const outflow = outflowDoc.data() as Outflow;

    // Step 4: Build OutflowEntry from period + outflow data
    const updatedEntry = buildOutflowEntry(periodData, outflow);

    // Step 5: Use transaction to prevent race conditions
    const summaryRef = db.collection('user_summaries').doc(summaryId);
    const now = Timestamp.now();

    await db.runTransaction(async (transaction) => {
      const summaryDoc = await transaction.get(summaryRef);

      let outflowsArray: OutflowEntry[] = [];

      if (summaryDoc.exists) {
        // Document exists - get current outflows array
        const summaryData = summaryDoc.data();
        outflowsArray = summaryData?.outflows || [];
      } else {
        console.log(`[updateOutflowPeriodSummary] Summary doesn't exist, will create new`);
      }

      // Find and update (or add) the specific entry
      const entryIndex = outflowsArray.findIndex(
        entry => entry.outflowPeriodId === periodData.id
      );

      if (entryIndex >= 0) {
        console.log(`[updateOutflowPeriodSummary] Updating existing entry at index ${entryIndex}`);
        outflowsArray[entryIndex] = updatedEntry;
      } else {
        console.log(`[updateOutflowPeriodSummary] Adding new entry`);
        outflowsArray.push(updatedEntry);
      }

      // Write back to Firestore within transaction
      if (summaryDoc.exists) {
        // Update existing document
        transaction.update(summaryRef, {
          outflows: outflowsArray,
          updatedAt: now,
          lastRecalculated: now
        });
      } else {
        // Create new document with proper structure
        transaction.set(summaryRef, {
          id: summaryId,
          userId: periodData.ownerId,
          sourcePeriodId: periodData.sourcePeriodId,
          periodType: periodType,
          periodStartDate: periodData.periodStartDate,
          periodEndDate: periodData.periodEndDate,
          year: periodData.periodStartDate.toDate().getFullYear(),
          month: periodData.periodStartDate.toDate().getMonth() + 1,
          outflows: outflowsArray,
          budgets: [],  // Initialize empty arrays for other resources
          inflows: [],
          goals: [],
          lastRecalculated: now,
          createdAt: now,
          updatedAt: now
        });
      }
    });

    console.log(`[updateOutflowPeriodSummary] ✓ Successfully updated ${summaryId}`);

  } catch (error) {
    console.error('[updateOutflowPeriodSummary] ❌ Error:', error);
    throw error;
  }
}

/**
 * Build OutflowEntry from OutflowPeriod + Outflow data
 */
function buildOutflowEntry(
  period: OutflowPeriod,
  outflow: Outflow
): OutflowEntry {
  // Calculate payment progress
  const paymentProgressPercentage = period.totalAmountDue > 0
    ? Math.round((period.totalAmountPaid / period.totalAmountDue) * 100)
    : 0;

  return {
    // Identity
    outflowPeriodId: period.id,  // CRITICAL: Used to find entry for updates
    outflowId: outflow.id,
    groupId: period.groupId || '',
    merchant: outflow.merchantName || outflow.description || 'Unknown',
    userCustomName: outflow.userCustomName || outflow.merchantName || outflow.description || 'Unknown',
    description: outflow.description || outflow.merchantName || 'Unknown',

    // Amounts
    totalAmountDue: period.totalAmountDue || 0,
    totalAmountPaid: period.totalAmountPaid || 0,
    totalAmountUnpaid: period.totalAmountUnpaid || 0,
    totalAmountWithheld: period.amountWithheld || 0,
    averageAmount: period.averageAmount || 0,

    // Due status
    isDuePeriod: period.isDuePeriod || false,
    duePeriodCount: period.isDuePeriod ? 1 : 0,
    dueDate: period.dueDate,
    status: period.status || OutflowPeriodStatus.PENDING,

    // Progress metrics
    paymentProgressPercentage,
    fullyPaidCount: period.isFullyPaid ? 1 : 0,
    unpaidCount: (!period.isFullyPaid && !period.isPartiallyPaid) ? 1 : 0,
    itemCount: 1
  };
}
