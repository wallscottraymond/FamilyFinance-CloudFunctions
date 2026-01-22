/**
 * Batch Update Outflow Period Summaries
 *
 * Efficiently updates multiple outflow period entries in user_summaries.
 * Groups updates by summary document to minimize transactions.
 *
 * Use this instead of calling updateOutflowPeriodSummary() multiple times
 * when processing bulk updates (e.g., 10+ periods at once).
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  OutflowPeriod,
  Outflow,
  OutflowPeriodStatus
} from '../../../../types';
import { OutflowEntry } from "../../../summaries/types";
import { determinePeriodType } from '../utils/periodTypeHelpers';

interface PeriodWithOutflow {
  period: OutflowPeriod;
  outflow: Outflow;
}

/**
 * Batch update multiple outflow period summaries
 *
 * @param periods - Array of OutflowPeriod objects to update
 * @returns Summary of results (success/failure counts)
 */
export async function batchUpdateOutflowPeriodSummaries(
  periods: OutflowPeriod[]
): Promise<{
  success: number;
  failed: number;
  errors: Array<{ periodId: string; error: string }>;
}> {
  console.log(`[batchUpdateOutflowPeriodSummaries] Processing ${periods.length} periods`);

  const db = admin.firestore();
  const results = {
    success: 0,
    failed: 0,
    errors: [] as Array<{ periodId: string; error: string }>
  };

  try {
    // Step 1: Fetch all parent outflows (in parallel)
    const outflowPromises = periods.map(async (period) => {
      try {
        const outflowDoc = await db.collection('outflows').doc(period.outflowId).get();
        if (!outflowDoc.exists) {
          console.warn(`[batchUpdateOutflowPeriodSummaries] ⚠️  Outflow ${period.outflowId} not found`);
          return null;
        }
        return {
          period,
          outflow: outflowDoc.data() as Outflow
        };
      } catch (error) {
        console.error(`[batchUpdateOutflowPeriodSummaries] Error fetching outflow ${period.outflowId}:`, error);
        return null;
      }
    });

    const periodsWithOutflows = (await Promise.all(outflowPromises))
      .filter((item): item is PeriodWithOutflow => item !== null);

    // Step 2: Group periods by summary document ID
    const periodsBySummaryId = new Map<string, PeriodWithOutflow[]>();

    for (const item of periodsWithOutflows) {
      const periodType = determinePeriodType(item.period.sourcePeriodId);
      const summaryId = `${item.period.ownerId}_${periodType.toLowerCase()}_${item.period.sourcePeriodId}`;

      if (!periodsBySummaryId.has(summaryId)) {
        periodsBySummaryId.set(summaryId, []);
      }
      periodsBySummaryId.get(summaryId)!.push(item);
    }

    console.log(`[batchUpdateOutflowPeriodSummaries] Grouped into ${periodsBySummaryId.size} summary documents`);

    // Step 3: Update each summary document (one transaction per document)
    const updatePromises = Array.from(periodsBySummaryId.entries()).map(
      async ([summaryId, items]) => {
        try {
          await updateSingleSummaryDocument(db, summaryId, items);
          results.success += items.length;
          console.log(`[batchUpdateOutflowPeriodSummaries] ✓ Updated ${items.length} entries in ${summaryId}`);
        } catch (error) {
          results.failed += items.length;
          items.forEach(item => {
            results.errors.push({
              periodId: item.period.id,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          });
          console.error(`[batchUpdateOutflowPeriodSummaries] ❌ Failed to update ${summaryId}:`, error);
        }
      }
    );

    await Promise.all(updatePromises);

    console.log(`[batchUpdateOutflowPeriodSummaries] Complete: ${results.success} success, ${results.failed} failed`);
    return results;

  } catch (error) {
    console.error('[batchUpdateOutflowPeriodSummaries] ❌ Fatal error:', error);
    throw error;
  }
}

/**
 * Update a single summary document with multiple period entries
 * Uses a transaction to ensure atomicity
 */
async function updateSingleSummaryDocument(
  db: admin.firestore.Firestore,
  summaryId: string,
  items: PeriodWithOutflow[]
): Promise<void> {
  const summaryRef = db.collection('user_summaries').doc(summaryId);
  const now = Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const summaryDoc = await transaction.get(summaryRef);

    let outflowsArray: OutflowEntry[] = [];

    if (summaryDoc.exists) {
      const summaryData = summaryDoc.data();
      outflowsArray = summaryData?.outflows || [];
    }

    // Update or add each period entry
    for (const { period, outflow } of items) {
      const updatedEntry = buildOutflowEntry(period, outflow);

      const entryIndex = outflowsArray.findIndex(
        entry => entry.outflowPeriodId === period.id
      );

      if (entryIndex >= 0) {
        outflowsArray[entryIndex] = updatedEntry;
      } else {
        outflowsArray.push(updatedEntry);
      }
    }

    // Write back to Firestore
    if (summaryDoc.exists) {
      transaction.update(summaryRef, {
        outflows: outflowsArray,
        updatedAt: now,
        lastRecalculated: now
      });
    } else {
      // Create new document (use first period for metadata)
      const firstPeriod = items[0].period;
      const periodType = determinePeriodType(firstPeriod.sourcePeriodId);

      transaction.set(summaryRef, {
        id: summaryId,
        userId: firstPeriod.ownerId,
        sourcePeriodId: firstPeriod.sourcePeriodId,
        periodType: periodType,
        periodStartDate: firstPeriod.periodStartDate,
        periodEndDate: firstPeriod.periodEndDate,
        year: firstPeriod.periodStartDate.toDate().getFullYear(),
        month: firstPeriod.periodStartDate.toDate().getMonth() + 1,
        outflows: outflowsArray,
        budgets: [],
        inflows: [],
        goals: [],
        lastRecalculated: now,
        createdAt: now,
        updatedAt: now
      });
    }
  });
}

/**
 * Build OutflowEntry from OutflowPeriod + Outflow data
 * (Duplicated from updateOutflowPeriodSummary.ts for independence)
 */
function buildOutflowEntry(
  period: OutflowPeriod,
  outflow: Outflow
): OutflowEntry {
  const paymentProgressPercentage = period.totalAmountDue > 0
    ? Math.round((period.totalAmountPaid / period.totalAmountDue) * 100)
    : 0;

  return {
    outflowPeriodId: period.id,
    outflowId: outflow.id,
    groupId: period.groupId || '',
    merchant: outflow.merchantName || outflow.description || 'Unknown',
    userCustomName: outflow.userCustomName || outflow.merchantName || outflow.description || 'Unknown',
    description: outflow.description || outflow.merchantName || 'Unknown',
    totalAmountDue: period.totalAmountDue || 0,
    totalAmountPaid: period.totalAmountPaid || 0,
    totalAmountUnpaid: period.totalAmountUnpaid || 0,
    totalAmountWithheld: period.amountWithheld || 0,
    averageAmount: period.averageAmount || 0,
    isDuePeriod: period.isDuePeriod || false,
    duePeriodCount: period.isDuePeriod ? 1 : 0,
    dueDate: period.dueDate,
    status: period.status || OutflowPeriodStatus.PENDING,
    paymentProgressPercentage,
    fullyPaidCount: period.isFullyPaid ? 1 : 0,
    unpaidCount: (!period.isFullyPaid && !period.isPartiallyPaid) ? 1 : 0,
    itemCount: 1
  };
}
