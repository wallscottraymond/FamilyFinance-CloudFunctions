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
import { Timestamp } from 'firebase-admin/firestore';
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
function getDaysInPeriod(startDate: Timestamp, endDate: Timestamp): number {
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
  const now = Timestamp.now();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[createOutflowPeriodsFromSource] STARTING OUTFLOW PERIOD CREATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`[createOutflowPeriodsFromSource] Input Parameters:`);
  console.log(`  - Outflow ID: ${outflowId}`);
  console.log(`  - Description: ${outflow.description || 'N/A'}`);
  console.log(`  - Frequency: ${outflow.frequency}`);
  console.log(`  - Date Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Extract fields from flat structure
  const ownerId = outflow.ownerId;
  const createdBy = outflow.createdBy;
  const groupId = outflow.groupId || null;
  const description = outflow.description || null;
  const merchantName = outflow.merchantName || null;

  // Get all source periods that overlap with our time range
  // Use year-based query (single range) to avoid Firestore limitation, then filter in memory
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  console.log('');
  console.log('[createOutflowPeriodsFromSource] STEP 1: QUERY SOURCE PERIODS');
  console.log(`  - Start Year: ${startYear}`);
  console.log(`  - End Year: ${endYear}`);
  console.log(`  - Query: source_periods WHERE year >= ${startYear}`);
  console.log(`  - Note: Upper bound (year <= ${endYear}) will be filtered in memory`);

  // DIAGNOSTIC: Check what's actually in the collection
  console.log('');
  console.log('[createOutflowPeriodsFromSource] DIAGNOSTIC: Sampling collection...');
  const allPeriodsSnapshot = await db.collection('source_periods').limit(5).get();
  console.log(`  - Total sample size: ${allPeriodsSnapshot.size} documents`);

  if (!allPeriodsSnapshot.empty) {
    allPeriodsSnapshot.docs.forEach((doc, index) => {
      const sample = doc.data();
      console.log(`  - Sample ${index + 1}: ID=${doc.id}, year=${sample.year}, type=${sample.type}, startDate=${sample.startDate?.toDate().toISOString().split('T')[0]}, endDate=${sample.endDate?.toDate().toISOString().split('T')[0]}`);
    });
  } else {
    console.warn('  ⚠️  WARNING: Collection appears to be EMPTY!');
  }

  // FIXED: Use single range query (Firestore doesn't support two range queries on same field)
  const sourcePeriodsQuery = db.collection('source_periods')
    .where('year', '>=', startYear);

  console.log('');
  console.log('[createOutflowPeriodsFromSource] Executing query...');
  const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
  console.log(`  ✓ Query returned ${sourcePeriodsSnapshot.size} documents`);

  if (sourcePeriodsSnapshot.empty) {
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ QUERY FAILED: No source periods found');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(`  - Query: year >= ${startYear}`);
    console.error(`  - Date range requested: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.error(`  - Possible causes:`);
    console.error(`    1. source_periods collection is empty (check emulator data)`);
    console.error(`    2. No periods exist for year >= ${startYear}`);
    console.error(`    3. Data was not persisted (emulator restart without persistence)`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return { periodsCreated: 0, periodIds: [] };
  }

  // Filter for upper year bound in memory (Firestore limitation workaround)
  console.log('');
  console.log('[createOutflowPeriodsFromSource] Filtering year upper bound in memory...');
  const yearFilteredPeriods = sourcePeriodsSnapshot.docs.filter(doc => {
    const data = doc.data();
    const inRange = data.year <= endYear;
    if (!inRange) {
      console.log(`  - Excluded: ${doc.id} (year=${data.year} > ${endYear})`);
    }
    return inRange;
  });
  console.log(`  ✓ After year filter: ${yearFilteredPeriods.length} documents (excluded ${sourcePeriodsSnapshot.size - yearFilteredPeriods.length})`);

  if (yearFilteredPeriods.length === 0) {
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ FILTER FAILED: No periods in year range');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(`  - Year range: ${startYear} to ${endYear}`);
    console.error(`  - All ${sourcePeriodsSnapshot.size} periods were outside this range`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return { periodsCreated: 0, periodIds: [] };
  }

  // Filter in memory for periods that overlap with our date range
  // A period overlaps if: period.endDate >= ourStartDate AND period.startDate <= ourEndDate
  console.log('');
  console.log('[createOutflowPeriodsFromSource] STEP 2: FILTER DATE OVERLAP');
  console.log(`  - Target range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log(`  - Overlap logic: period.endDate >= ${startDate.toISOString().split('T')[0]} AND period.startDate <= ${endDate.toISOString().split('T')[0]}`);

  let overlapCount = 0;
  let excludedCount = 0;

  const overlappingPeriods = yearFilteredPeriods.filter(doc => {
    const data = doc.data() as SourcePeriod;
    const periodStart = data.startDate.toDate();
    const periodEnd = data.endDate.toDate();
    const overlaps = periodEnd >= startDate && periodStart <= endDate;

    if (overlaps) {
      overlapCount++;
      if (overlapCount <= 5) { // Log first 5 matches
        console.log(`  ✓ MATCH #${overlapCount}: ${doc.id} (${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]})`);
      }
    } else {
      excludedCount++;
      if (excludedCount <= 3) { // Log first 3 exclusions
        console.log(`  ✗ Excluded: ${doc.id} (${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}) - no overlap`);
      }
    }
    return overlaps;
  });

  console.log('');
  console.log(`[createOutflowPeriodsFromSource] Date overlap filtering complete:`);
  console.log(`  ✓ Overlapping periods: ${overlappingPeriods.length}`);
  console.log(`  ✗ Excluded (no overlap): ${excludedCount}`);
  console.log(`  📊 Total processed: ${yearFilteredPeriods.length}`);

  if (overlappingPeriods.length === 0) {
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ DATE OVERLAP FILTER FAILED: No matching periods');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error(`  - Requested range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.error(`  - Periods checked: ${yearFilteredPeriods.length}`);
    console.error(`  - None of these periods overlap with the requested date range`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    return { periodsCreated: 0, periodIds: [] };
  }

  // Calculate payment cycle information
  const cycleInfo = calculatePaymentCycle(outflow);
  console.log(`[createOutflowPeriodsFromSource] Payment cycle: ${cycleInfo.cycleDays} days, Bill: $${cycleInfo.billAmount.toFixed(2)}`);

  // Create outflow_periods for each source period
  const outflowPeriods: OutflowPeriod[] = [];
  const periodIds: string[] = [];

  for (const doc of overlappingPeriods) {
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
      cycleStartDate: Timestamp.fromDate(new Date()), // Placeholder
      cycleEndDate: Timestamp.fromDate(new Date()), // Placeholder
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
