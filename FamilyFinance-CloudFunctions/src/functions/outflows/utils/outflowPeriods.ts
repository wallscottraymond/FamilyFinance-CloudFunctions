/**
 * Outflow Period Creation Utilities - FLAT STRUCTURE
 *
 * Provides utilities for creating and managing outflow_periods based on
 * recurring outflows and source periods.
 *
 * UPDATED: Complete flat structure with multi-occurrence tracking.
 * This is the single source of truth for outflow period generation.
 */

import * as admin from 'firebase-admin';
import {
  OutflowPeriod,
  SourcePeriod
} from '../../../types';
import {
  calculatePaymentCycle,
  calculateWithholdingAmount
} from './calculateWithholdingAmount';
import { calculateAllOccurrencesInPeriod } from './calculateAllOccurrencesInPeriod';

/**
 * Result of creating outflow periods
 */
export interface CreateOutflowPeriodsResult {
  periodsCreated: number;
  periodIds: string[];
}

/**
 * Calculate the date range for outflow period generation
 *
 * @param outflow - The recurring outflow (supports both flat and nested structure)
 * @param monthsForward - Number of months to generate forward from now (default: 15)
 * @returns Object with startDate and endDate
 */
export function calculatePeriodGenerationRange(
  outflow: any,
  monthsForward: number = 15
): { startDate: Date; endDate: Date } {
  // Start from firstDate to capture historical periods
  const startDate = outflow.firstDate.toDate();

  // Extend N months forward from now
  const now = new Date();
  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + monthsForward);

  return { startDate, endDate };
}

/**
 * Helper function to calculate days in a period
 */
function getDaysInPeriod(startDate: admin.firestore.Timestamp, endDate: admin.firestore.Timestamp): number {
  const start = startDate.toDate();
  const end = endDate.toDate();
  const diffMs = end.getTime() - start.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end day
}

/**
 * Create outflow periods from source periods for a given outflow - FLAT STRUCTURE
 *
 * UPDATED: Complete flat structure with multi-occurrence tracking.
 * - All fields at root level (no nested access, categories, metadata, relationships objects)
 * - Uses calculateAllOccurrencesInPeriod to handle variable occurrences (4 vs 5 Mondays)
 * - Tracks individual occurrence due dates, payment status, and transaction IDs
 * - Supports both unit tracking (2/4 paid) and dollar tracking ($20/$40)
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data (flat structure)
 * @param startDate - Start date for period generation
 * @param endDate - End date for period generation
 * @returns Result with count and IDs of created periods
 */
export async function createOutflowPeriodsFromSource(
  db: admin.firestore.Firestore,
  outflowId: string,
  outflow: any, // Accept flat outflow structure
  startDate: Date,
  endDate: Date
): Promise<CreateOutflowPeriodsResult> {
  const now = admin.firestore.Timestamp.now();

  console.log(`[createOutflowPeriodsFromSource] Generating FLAT outflow periods from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Extract fields from flat structure
  const ownerId = outflow.ownerId;
  const createdBy = outflow.createdBy;
  const groupId = outflow.groupId || null;
  const description = outflow.description || null;
  const merchantName = outflow.merchantName || null;

  // Get all source periods that overlap with our time range
  const sourcePeriodsQuery = db.collection('source_periods')
    .where('startDate', '>=', admin.firestore.Timestamp.fromDate(startDate))
    .where('startDate', '<=', admin.firestore.Timestamp.fromDate(endDate));

  const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();

  if (sourcePeriodsSnapshot.empty) {
    console.warn('[createOutflowPeriodsFromSource] No source periods found in date range');
    return { periodsCreated: 0, periodIds: [] };
  }

  console.log(`[createOutflowPeriodsFromSource] Found ${sourcePeriodsSnapshot.size} source periods to process`);

  // Calculate payment cycle information
  const cycleInfo = calculatePaymentCycle(outflow);
  console.log(`[createOutflowPeriodsFromSource] Payment cycle: ${cycleInfo.cycleDays} days, Bill: $${cycleInfo.billAmount.toFixed(2)}`);

  // Create outflow_periods for each source period
  const outflowPeriods: OutflowPeriod[] = [];
  const periodIds: string[] = [];

  for (const doc of sourcePeriodsSnapshot.docs) {
    const sourcePeriod = { id: doc.id, ...doc.data() } as SourcePeriod;

    // Calculate ALL occurrences in this period (handles variable 4 vs 5 Mondays)
    const occurrences = calculateAllOccurrencesInPeriod(outflow, sourcePeriod);

    // Calculate withholding amounts for this period
    const periodCalc = calculateWithholdingAmount(sourcePeriod, cycleInfo, outflow);

    // Calculate financial totals based on occurrences
    const amountPerOccurrence = cycleInfo.billAmount;
    const totalAmountDue = amountPerOccurrence * occurrences.numberOfOccurrences;
    const totalAmountPaid = 0; // At creation, nothing is paid yet
    const totalAmountUnpaid = totalAmountDue;

    // Initialize occurrence tracking arrays (all unpaid at creation)
    const occurrencePaidFlags = new Array(occurrences.numberOfOccurrences).fill(false);
    const occurrenceTransactionIds = new Array(occurrences.numberOfOccurrences).fill(null);

    // Calculate progress metrics
    const paymentProgressPercentage = 0; // No payments yet
    const dollarProgressPercentage = 0; // No payments yet

    // Determine payment status
    const isFullyPaid = false;
    const isPartiallyPaid = false;

    // Determine first and last due dates
    const firstDueDateInPeriod = occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[0] : null;
    const lastDueDateInPeriod = occurrences.numberOfOccurrences > 0
      ? occurrences.occurrenceDueDates[occurrences.numberOfOccurrences - 1]
      : null;
    const nextUnpaidDueDate = firstDueDateInPeriod; // First due date is next unpaid

    // No need to calculate status/days - these are computed on read

    if (occurrences.numberOfOccurrences > 0) {
      console.log(
        `[createOutflowPeriodsFromSource] ${description} - ${occurrences.numberOfOccurrences} occurrence(s) in ${sourcePeriod.id}: ` +
        `$${totalAmountDue.toFixed(2)} total (${occurrences.occurrenceDueDates.map(d => d.toDate().toISOString().split('T')[0]).join(', ')})`
      );
    }

    const periodId = `${outflowId}_${sourcePeriod.id}`;

    // Build FLAT outflow period structure
    const outflowPeriodDoc: OutflowPeriod = {
      // === IDENTITY ===
      id: periodId,
      outflowId: outflowId,
      sourcePeriodId: sourcePeriod.id!,

      // === OWNERSHIP & ACCESS (Query-Critical) ===
      ownerId: ownerId,
      createdBy: createdBy,
      updatedBy: createdBy,
      groupId: groupId,

      // === PLAID IDENTIFIERS ===
      accountId: outflow.accountId,
      plaidItemId: outflow.plaidItemId,

      // === FINANCIAL TRACKING ===
      actualAmount: null, // Null until transaction attached
      amountWithheld: periodCalc.amountWithheld,
      averageAmount: cycleInfo.billAmount, // Use bill amount as average
      expectedAmount: totalAmountDue,
      amountPerOccurrence: amountPerOccurrence,
      totalAmountDue: totalAmountDue,
      totalAmountPaid: totalAmountPaid,
      totalAmountUnpaid: totalAmountUnpaid,

      // === TIMESTAMPS ===
      createdAt: now,
      updatedAt: now,
      lastCalculated: now,

      // === PAYMENT CYCLE INFO ===
      currency: 'USD', // Default to USD, update from Plaid data if available
      cycleDays: cycleInfo.cycleDays,
      cycleStartDate: admin.firestore.Timestamp.fromDate(new Date()), // Placeholder
      cycleEndDate: admin.firestore.Timestamp.fromDate(new Date()), // Placeholder
      dailyWithholdingRate: periodCalc.amountWithheld / getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate),

      // === OUTFLOW METADATA (Denormalized) ===
      description: description,
      frequency: outflow.frequency,

      // === PAYMENT STATUS ===
      isPaid: isFullyPaid, // Legacy: same as isFullyPaid
      isFullyPaid: isFullyPaid,
      isPartiallyPaid: isPartiallyPaid,
      isDuePeriod: occurrences.numberOfOccurrences > 0,

      // === CATEGORIZATION ===
      internalDetailedCategory: outflow.internalDetailedCategory || null,
      internalPrimaryCategory: outflow.internalPrimaryCategory || null,
      plaidPrimaryCategory: outflow.plaidPrimaryCategory || 'GENERAL_SERVICES',
      plaidDetailedCategory: outflow.plaidDetailedCategory || '',

      // === STATUS & CONTROL ===
      isActive: true,
      isHidden: false,

      // === MERCHANT INFO ===
      merchant: merchantName,
      payee: merchantName,

      // === PERIOD CONTEXT ===
      periodStartDate: sourcePeriod.startDate,
      periodEndDate: sourcePeriod.endDate,
      periodType: sourcePeriod.type,

      // === PLAID PREDICTION ===
      predictedNextDate: outflow.predictedNextDate || null,

      // === USER INTERACTION ===
      rules: [],
      tags: outflow.tags || [],
      type: outflow.type || 'expense',
      note: null,
      userCustomName: null,

      // === SOURCE ===
      source: outflow.source || 'plaid',

      // === TRANSACTION TRACKING ===
      transactionIds: [],

      // === MULTI-OCCURRENCE TRACKING ===
      numberOfOccurrencesInPeriod: occurrences.numberOfOccurrences,
      numberOfOccurrencesPaid: 0,
      numberOfOccurrencesUnpaid: occurrences.numberOfOccurrences,
      occurrenceDueDates: occurrences.occurrenceDueDates,
      occurrencePaidFlags: occurrencePaidFlags,
      occurrenceTransactionIds: occurrenceTransactionIds,

      // === PROGRESS METRICS ===
      paymentProgressPercentage: paymentProgressPercentage,
      dollarProgressPercentage: dollarProgressPercentage,

      // === DUE DATE TRACKING ===
      firstDueDateInPeriod: firstDueDateInPeriod,
      lastDueDateInPeriod: lastDueDateInPeriod,
      nextUnpaidDueDate: nextUnpaidDueDate
    } as any;

    outflowPeriods.push(outflowPeriodDoc);
    periodIds.push(periodId);
  }

  console.log(`[createOutflowPeriodsFromSource] Creating ${outflowPeriods.length} FLAT outflow periods`);

  // Batch create all outflow_periods
  await batchCreateOutflowPeriods(db, outflowPeriods);

  console.log(`[createOutflowPeriodsFromSource] Successfully created ${outflowPeriods.length} FLAT outflow periods`);

  return {
    periodsCreated: outflowPeriods.length,
    periodIds
  };
}

/**
 * Efficiently create multiple outflow_periods using Firestore batch operations
 *
 * @param db - Firestore instance
 * @param outflowPeriods - Array of outflow periods to create
 */
export async function batchCreateOutflowPeriods(
  db: admin.firestore.Firestore,
  outflowPeriods: OutflowPeriod[]
): Promise<void> {
  const BATCH_SIZE = 500; // Firestore batch limit

  for (let i = 0; i < outflowPeriods.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchPeriods = outflowPeriods.slice(i, i + BATCH_SIZE);

    batchPeriods.forEach((outflowPeriod) => {
      const docRef = db.collection('outflow_periods').doc(outflowPeriod.id!);
      batch.set(docRef, outflowPeriod);
    });

    await batch.commit();
    console.log(`[batchCreateOutflowPeriods] Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(outflowPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
  }
}
