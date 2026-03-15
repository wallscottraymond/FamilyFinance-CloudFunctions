/**
 * Admin HTTP Endpoint: Regenerate Inflow Periods
 *
 * Temporary admin function to regenerate inflow periods for data repair.
 * This is an HTTP function (not callable) that can be invoked directly.
 *
 * Security: Protected by a simple admin key in the request header.
 *
 * Usage:
 *   curl -X POST \
 *     -H "x-admin-key: family-finance-admin-2025" \
 *     https://us-central1-family-budget-app-cb59b.cloudfunctions.net/adminRegenerateInflowPeriods
 *
 * Or for a specific user:
 *   curl -X POST \
 *     -H "x-admin-key: family-finance-admin-2025" \
 *     -H "Content-Type: application/json" \
 *     -d '{"userId": "USER_ID_HERE"}' \
 *     https://us-central1-family-budget-app-cb59b.cloudfunctions.net/adminRegenerateInflowPeriods
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  InflowPeriod,
  SourcePeriod,
  PlaidRecurringFrequency
} from '../../../../types';
import { calculateAllOccurrencesInPeriod } from '../utils/calculateAllOccurrencesInPeriod';

// Simple admin key for this one-time task
const ADMIN_KEY = 'family-finance-admin-2025';

interface RegenerateResult {
  usersProcessed: number;
  inflowsProcessed: number;
  periodsCreated: number;
  periodsUpdated: number;
  errors: string[];
}

export const adminRegenerateInflowPeriods = onRequest(
  {
    region: 'us-central1',
    memory: '1GiB',
    timeoutSeconds: 540, // 9 minutes max
    cors: false,
  },
  async (request, response) => {
    // Verify admin key
    const adminKey = request.headers['x-admin-key'];
    if (adminKey !== ADMIN_KEY) {
      response.status(403).json({ error: 'Unauthorized' });
      return;
    }

    const db = admin.firestore();
    const result: RegenerateResult = {
      usersProcessed: 0,
      inflowsProcessed: 0,
      periodsCreated: 0,
      periodsUpdated: 0,
      errors: []
    };

    // Get userId from request body if provided
    let targetUserId: string | null = null;
    if (request.body && request.body.userId) {
      targetUserId = request.body.userId;
    }

    console.log(`[adminRegenerateInflowPeriods] Starting. Target user: ${targetUserId || 'ALL'}`);

    try {
      // Get all active inflows
      let inflowsQuery: FirebaseFirestore.Query;
      if (targetUserId) {
        inflowsQuery = db.collection('inflows')
          .where('ownerId', '==', targetUserId)
          .where('isActive', '==', true);
      } else {
        inflowsQuery = db.collection('inflows')
          .where('isActive', '==', true);
      }

      const inflowsSnapshot = await inflowsQuery.get();
      console.log(`[adminRegenerateInflowPeriods] Found ${inflowsSnapshot.size} active inflows`);

      const processedUsers = new Set<string>();

      for (const inflowDoc of inflowsSnapshot.docs) {
        const inflowData = inflowDoc.data();
        const inflowId = inflowDoc.id;
        const userId = inflowData.ownerId;

        processedUsers.add(userId);
        result.inflowsProcessed++;

        console.log(`\n[adminRegenerateInflowPeriods] Processing inflow: ${inflowId}`);
        console.log(`  Description: ${inflowData.description || inflowData.payerName || 'Unknown'}`);
        console.log(`  Frequency: ${inflowData.frequency}`);
        console.log(`  First Date: ${inflowData.firstDate?.toDate().toISOString()}`);
        console.log(`  Last Date: ${inflowData.lastDate?.toDate().toISOString()}`);
        console.log(`  Predicted Next: ${inflowData.predictedNextDate?.toDate().toISOString() || 'N/A'}`);

        try {
          await processInflow(db, inflowId, inflowData, result);
        } catch (error: any) {
          console.error(`[adminRegenerateInflowPeriods] Error processing inflow ${inflowId}:`, error);
          result.errors.push(`Inflow ${inflowId}: ${error.message}`);
        }
      }

      result.usersProcessed = processedUsers.size;
      console.log(`\n[adminRegenerateInflowPeriods] Complete:`, result);

      response.status(200).json({
        success: true,
        result
      });

    } catch (error: any) {
      console.error('[adminRegenerateInflowPeriods] Error:', error);
      response.status(500).json({
        success: false,
        error: error.message,
        result
      });
    }
  }
);

async function processInflow(
  db: admin.firestore.Firestore,
  inflowId: string,
  inflowData: any,
  result: RegenerateResult
): Promise<void> {
  const userId = inflowData.ownerId;
  const groupId = inflowData.groupId || null;
  const now = Timestamp.now();

  // Calculate time range: from inflow's firstDate to 3 months forward
  const startDate = inflowData.firstDate?.toDate() || new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + 3);

  console.log(`  Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Get source periods in range
  const sourcePeriodsQuery = db.collection('source_periods')
    .where('startDate', '>=', Timestamp.fromDate(startDate))
    .where('startDate', '<=', Timestamp.fromDate(endDate));

  const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();

  if (sourcePeriodsSnapshot.empty) {
    console.log(`  No source periods found in range`);
    return;
  }

  console.log(`  Found ${sourcePeriodsSnapshot.size} source periods`);

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

    // Use proper utility that checks actual income dates against period boundaries
    const occurrences = calculateAllOccurrencesInPeriod(inflowData, sourcePeriod);

    const amountPerOccurrence = cycleInfo.incomeAmount;
    const totalAmountDue = amountPerOccurrence * occurrences.numberOfOccurrences;

    const periodDays = getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate);
    const amountEarned = cycleInfo.dailyRate * periodDays;

    // Log occurrence details for verification
    if (occurrences.numberOfOccurrences > 0) {
      const dueDates = occurrences.occurrenceDueDates.map((d: Timestamp) => d.toDate().toISOString().split('T')[0]);
      console.log(`    Period ${sourcePeriod.id}: ${occurrences.numberOfOccurrences} occurrence(s) on ${dueDates.join(', ')}`);
    }

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
      amountWithheld: Math.round(amountEarned * 100) / 100,
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
      dailyWithholdingRate: amountEarned / periodDays,
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

    // Commit batch every 400 operations
    if (batchCount >= 400) {
      await batch.commit();
      batchCount = 0;
    }
  }

  // Commit remaining operations
  if (batchCount > 0) {
    await batch.commit();
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

function getDaysInPeriod(startDate: Timestamp, endDate: Timestamp): number {
  const start = startDate.toDate();
  const end = endDate.toDate();
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
