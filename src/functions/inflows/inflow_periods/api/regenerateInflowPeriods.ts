/**
 * Regenerate Inflow Periods Callable
 *
 * Admin/dev function to regenerate inflow_periods for an existing inflow.
 * Useful for fixing data when periods weren't created correctly.
 *
 * Usage:
 * - Call with inflowId to regenerate periods for that specific inflow
 * - Call without inflowId to regenerate for all user's inflows
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  InflowPeriod,
  SourcePeriod,
  PlaidRecurringFrequency
} from '../../../../types';
import { calculateAllOccurrencesInPeriod } from '../utils/calculateAllOccurrencesInPeriod';

interface RegenerateRequest {
  inflowId?: string;  // Optional - if omitted, regenerates all user's inflows
}

interface RegenerateResult {
  inflowsProcessed: number;
  periodsCreated: number;
  periodsUpdated: number;
  errors: string[];
}

export const regenerateInflowPeriods = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (request): Promise<RegenerateResult> => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    const { inflowId } = request.data as RegenerateRequest;

    const db = admin.firestore();
    const result: RegenerateResult = {
      inflowsProcessed: 0,
      periodsCreated: 0,
      periodsUpdated: 0,
      errors: []
    };

    console.log(`[regenerateInflowPeriods] Starting for user: ${userId}, inflowId: ${inflowId || 'ALL'}`);

    try {
      // Get inflows to process
      let inflowsQuery = db.collection('inflows')
        .where('ownerId', '==', userId)
        .where('isActive', '==', true);

      if (inflowId) {
        // Fetch specific inflow
        const inflowDoc = await db.collection('inflows').doc(inflowId).get();
        if (!inflowDoc.exists) {
          throw new HttpsError('not-found', `Inflow ${inflowId} not found`);
        }

        const inflowData = inflowDoc.data();
        if (inflowData?.ownerId !== userId) {
          throw new HttpsError('permission-denied', 'You can only regenerate your own inflows');
        }

        await processInflow(db, inflowDoc.id, inflowData, result);
      } else {
        // Process all user's inflows
        const inflowsSnapshot = await inflowsQuery.get();
        console.log(`[regenerateInflowPeriods] Found ${inflowsSnapshot.size} inflows to process`);

        for (const inflowDoc of inflowsSnapshot.docs) {
          await processInflow(db, inflowDoc.id, inflowDoc.data(), result);
        }
      }

      console.log(`[regenerateInflowPeriods] Complete:`, result);
      return result;

    } catch (error: any) {
      console.error('[regenerateInflowPeriods] Error:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', error.message || 'Failed to regenerate inflow periods');
    }
  }
);

async function processInflow(
  db: admin.firestore.Firestore,
  inflowId: string,
  inflowData: any,
  result: RegenerateResult
): Promise<void> {
  try {
    result.inflowsProcessed++;
    console.log(`[regenerateInflowPeriods] Processing inflow: ${inflowId}`);

    const userId = inflowData.ownerId;
    const groupId = inflowData.groupId || null;
    const now = Timestamp.now();

    // Calculate time range: from inflow's firstDate to 12 months forward
    // This ensures we generate periods for the entire history of the inflow (matches budget periods)
    const startDate = inflowData.firstDate?.toDate() || new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 12); // 12 months forward (matches budgets)

    console.log(`[regenerateInflowPeriods] Date range: ${startDate.toISOString()} (inflow firstDate) to ${endDate.toISOString()} (12 months forward)`);

    // Get source periods in range
    const sourcePeriodsQuery = db.collection('source_periods')
      .where('startDate', '>=', Timestamp.fromDate(startDate))
      .where('startDate', '<=', Timestamp.fromDate(endDate));

    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();

    if (sourcePeriodsSnapshot.empty) {
      console.log(`[regenerateInflowPeriods] No source periods found for inflow ${inflowId}`);
      return;
    }

    console.log(`[regenerateInflowPeriods] Found ${sourcePeriodsSnapshot.size} source periods`);

    // Calculate payment cycle info
    const cycleInfo = calculatePaymentCycle(inflowData);

    // Process each source period
    const batch = db.batch();
    let batchCount = 0;

    for (const sourcePeriodDoc of sourcePeriodsSnapshot.docs) {
      const sourcePeriod = { id: sourcePeriodDoc.id, ...sourcePeriodDoc.data() } as SourcePeriod;
      const periodId = `${inflowId}_${sourcePeriod.id}`;

      // Check if period already exists
      const existingPeriodDoc = await db.collection('inflow_periods').doc(periodId).get();

      // Calculate period amounts
      const periodCalc = calculatePeriodAmounts(sourcePeriod, cycleInfo, inflowData);
      // Use proper utility that checks actual income dates against period boundaries
      const occurrences = calculateAllOccurrencesInPeriod(inflowData, sourcePeriod);

      const amountPerOccurrence = cycleInfo.incomeAmount;
      const totalAmountDue = amountPerOccurrence * occurrences.numberOfOccurrences;

      // Build inflow period document
      const inflowPeriodDoc: Partial<InflowPeriod> = {
        id: periodId,
        inflowId: inflowId,
        sourcePeriodId: sourcePeriod.id!,
        ownerId: userId,
        createdBy: inflowData.createdBy || userId,
        updatedBy: userId,
        groupId: groupId,
        accountId: inflowData.accountId,
        plaidItemId: inflowData.plaidItemId,
        actualAmount: null,
        amountWithheld: periodCalc.amountEarned,
        averageAmount: cycleInfo.incomeAmount,
        expectedAmount: totalAmountDue,
        amountPerOccurrence: amountPerOccurrence,
        totalAmountDue: totalAmountDue,
        totalAmountPaid: 0,
        totalAmountUnpaid: totalAmountDue,
        createdAt: existingPeriodDoc.exists ? existingPeriodDoc.data()?.createdAt : now,
        updatedAt: now,
        lastCalculated: now,
        currency: inflowData.currency || 'USD',
        cycleDays: cycleInfo.cycleDays,
        cycleStartDate: cycleInfo.cycleStartDate,
        cycleEndDate: cycleInfo.cycleEndDate,
        dailyWithholdingRate: periodCalc.amountEarned / getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate),
        description: inflowData.description,
        frequency: inflowData.frequency,
        isPaid: false,
        isFullyPaid: false,
        isPartiallyPaid: false,
        isReceiptPeriod: occurrences.numberOfOccurrences > 0,
        internalDetailedCategory: inflowData.internalDetailedCategory || null,
        internalPrimaryCategory: inflowData.internalPrimaryCategory || null,
        plaidPrimaryCategory: inflowData.plaidPrimaryCategory || 'INCOME',
        plaidDetailedCategory: inflowData.plaidDetailedCategory || '',
        isActive: true,
        isHidden: false,
        merchant: inflowData.merchantName,
        payee: inflowData.merchantName,
        periodStartDate: sourcePeriod.startDate,
        periodEndDate: sourcePeriod.endDate,
        periodType: sourcePeriod.type,
        predictedNextDate: inflowData.predictedNextDate || null,
        rules: [],
        tags: inflowData.tags || [],
        type: inflowData.type || 'income',
        note: null,
        userCustomName: inflowData.userCustomName || null,
        source: inflowData.source || 'plaid',
        transactionIds: [],
        numberOfOccurrencesInPeriod: occurrences.numberOfOccurrences,
        numberOfOccurrencesPaid: 0,
        numberOfOccurrencesUnpaid: occurrences.numberOfOccurrences,
        occurrenceDueDates: occurrences.occurrenceDueDates,
        occurrencePaidFlags: new Array(occurrences.numberOfOccurrences).fill(false),
        occurrenceTransactionIds: new Array(occurrences.numberOfOccurrences).fill(null),
        paymentProgressPercentage: 0,
        dollarProgressPercentage: 0,
        firstDueDateInPeriod: occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[0] : null,
        lastDueDateInPeriod: occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[occurrences.numberOfOccurrences - 1] : null,
        nextUnpaidDueDate: occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[0] : null
      };

      const docRef = db.collection('inflow_periods').doc(periodId);

      if (existingPeriodDoc.exists) {
        batch.update(docRef, inflowPeriodDoc as any);
        result.periodsUpdated++;
      } else {
        batch.set(docRef, inflowPeriodDoc as any);
        result.periodsCreated++;
      }

      batchCount++;

      // Commit batch every 500 operations
      if (batchCount >= 500) {
        await batch.commit();
        batchCount = 0;
      }
    }

    // Commit remaining operations
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`[regenerateInflowPeriods] Processed inflow ${inflowId}: created ${result.periodsCreated}, updated ${result.periodsUpdated}`);

  } catch (error: any) {
    console.error(`[regenerateInflowPeriods] Error processing inflow ${inflowId}:`, error);
    result.errors.push(`Inflow ${inflowId}: ${error.message}`);
  }
}

function calculatePaymentCycle(inflow: any) {
  const incomeAmount = Math.abs(
    typeof inflow.averageAmount === 'number'
      ? inflow.averageAmount
      : inflow.averageAmount?.amount || 0
  );

  let cycleDays: number;
  switch (inflow.frequency) {
    case PlaidRecurringFrequency.WEEKLY:
      cycleDays = 7;
      break;
    case PlaidRecurringFrequency.BIWEEKLY:
      cycleDays = 14;
      break;
    case PlaidRecurringFrequency.SEMI_MONTHLY:
      cycleDays = 15;
      break;
    case PlaidRecurringFrequency.MONTHLY:
      cycleDays = 30;
      break;
    case PlaidRecurringFrequency.ANNUALLY:
      cycleDays = 365;
      break;
    default:
      cycleDays = 30;
  }

  const dailyRate = incomeAmount / cycleDays;
  const cycleEndDate = inflow.lastDate;
  const cycleStartDate = Timestamp.fromDate(
    new Date(cycleEndDate.toDate().getTime() - (cycleDays * 24 * 60 * 60 * 1000))
  );

  return { incomeAmount, cycleDays, dailyRate, cycleStartDate, cycleEndDate };
}

function calculatePeriodAmounts(
  sourcePeriod: SourcePeriod,
  cycleInfo: ReturnType<typeof calculatePaymentCycle>,
  inflow: any
) {
  const periodStart = sourcePeriod.startDate.toDate();
  const periodEnd = sourcePeriod.endDate.toDate();
  const daysInPeriod = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const amountEarned = cycleInfo.dailyRate * daysInPeriod;

  return {
    amountEarned: Math.round(amountEarned * 100) / 100,
  };
}

function getDaysInPeriod(startDate: Timestamp, endDate: Timestamp): number {
  const start = startDate.toDate();
  const end = endDate.toDate();
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
