/**
 * Outflow Period Creation Utilities
 *
 * Provides utilities for creating and managing outflow_periods based on
 * recurring outflows and source periods.
 *
 * This is the single source of truth for outflow period generation.
 */

import * as admin from 'firebase-admin';
import {
  RecurringOutflow,
  OutflowPeriod,
  SourcePeriod
} from '../../../types';
import {
  calculatePaymentCycle,
  calculateWithholdingAmount
} from './calculateWithholdingAmount';
import { predictFutureBillDueDate } from './predictFutureBillDueDate';
import { checkIsDuePeriod } from './checkIsDuePeriod';
import { calculateOutflowPeriodStatus } from './calculateOutflowPeriodStatus';

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
 * @param outflow - The recurring outflow
 * @param monthsForward - Number of months to generate forward from now (default: 15)
 * @returns Object with startDate and endDate
 */
export function calculatePeriodGenerationRange(
  outflow: RecurringOutflow,
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

// Note: Payment cycle and withholding calculations are now in calculateWithholdingAmount.ts
// This keeps period creation focused on orchestration, not calculation logic

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
 * Create outflow periods from source periods for a given outflow
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data
 * @param startDate - Start date for period generation
 * @param endDate - End date for period generation
 * @returns Result with count and IDs of created periods
 */
export async function createOutflowPeriodsFromSource(
  db: admin.firestore.Firestore,
  outflowId: string,
  outflow: RecurringOutflow,
  startDate: Date,
  endDate: Date
): Promise<CreateOutflowPeriodsResult> {
  const now = admin.firestore.Timestamp.now();

  console.log(`[createOutflowPeriodsFromSource] Generating periods from ${startDate.toISOString()} to ${endDate.toISOString()}`);

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
  const avgDailyRate = cycleInfo.billAmount / cycleInfo.cycleDays;
  console.log(`[createOutflowPeriodsFromSource] Payment cycle: ${cycleInfo.cycleDays} days, Avg Rate: $${avgDailyRate.toFixed(2)}/day`);

  // Create outflow_periods for each source period
  const outflowPeriods: OutflowPeriod[] = [];
  const periodIds: string[] = [];

  sourcePeriodsSnapshot.forEach((doc) => {
    const sourcePeriod = { id: doc.id, ...doc.data() } as SourcePeriod;

    // Calculate withholding amounts for this period
    const periodCalc = calculateWithholdingAmount(sourcePeriod, cycleInfo, outflow);

    // Predict next expected due date and draw date for this period
    const expectedDates = predictFutureBillDueDate(outflow, sourcePeriod);

    // Check if the expected due date falls within this period
    const isDuePeriodByExpectedDate = checkIsDuePeriod(
      expectedDates.expectedDueDate,
      sourcePeriod.startDate,
      sourcePeriod.endDate
    );

    // Use the expected due date check for isDuePeriod and amountDue
    const isDuePeriod = isDuePeriodByExpectedDate;
    const amountDue = isDuePeriod ? cycleInfo.billAmount : 0;
    const dueDate = isDuePeriod ? expectedDates.expectedDueDate : undefined;

    // Determine bill status using utility function
    // Note: At creation time, transactionSplits is empty. Status will be recalculated after auto-matching.
    const billStatus = calculateOutflowPeriodStatus(
      isDuePeriod,
      dueDate,
      expectedDates.expectedDueDate,
      amountDue,
      [] // Empty array at creation - will be populated by auto-matching
    );

    if (isDuePeriod) {
      console.log(
        `[createOutflowPeriodsFromSource] ${outflow.description} - DUE in ${sourcePeriod.id}: ` +
        `$${amountDue.toFixed(2)} on ${expectedDates.expectedDueDate.toDate().toISOString().split('T')[0]}`
      );
    }

    const periodId = `${outflowId}_${sourcePeriod.id}`;

    const outflowPeriod: OutflowPeriod = {
      id: periodId,
      outflowId: outflowId,
      periodId: sourcePeriod.id!,
      sourcePeriodId: sourcePeriod.id!,
      userId: outflow.userId,
      familyId: outflow.familyId,

      // Period context (denormalized for performance)
      periodType: sourcePeriod.type,
      periodStartDate: sourcePeriod.startDate,
      periodEndDate: sourcePeriod.endDate,

      // Payment cycle information
      cycleStartDate: cycleInfo.cycleStartDate,
      cycleEndDate: cycleInfo.cycleEndDate,
      cycleDays: cycleInfo.cycleDays,

      // Financial calculations
      billAmount: cycleInfo.billAmount,
      dailyWithholdingRate: periodCalc.amountWithheld / getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate), // Calculate actual daily rate for this period
      amountWithheld: periodCalc.amountWithheld,
      amountDue: amountDue, // Use calculated amount based on expected due date

      // Payment status - based on expected due date
      isDuePeriod: isDuePeriod,
      dueDate: dueDate,
      expectedDueDate: expectedDates.expectedDueDate,
      expectedDrawDate: expectedDates.expectedDrawDate,
      status: billStatus, // Status determined by updateBillStatus utility
      isActive: true,
      transactionSplits: [], // Initialize empty array for tracking payment transactions

      // Metadata from outflow (denormalized for performance)
      outflowDescription: outflow.description,
      outflowMerchantName: outflow.merchantName,
      outflowExpenseType: outflow.expenseType,
      outflowIsEssential: outflow.isEssential,

      // System fields
      createdAt: now,
      updatedAt: now,
      lastCalculated: now,
    };

    outflowPeriods.push(outflowPeriod);
    periodIds.push(periodId);
  });

  console.log(`[createOutflowPeriodsFromSource] Creating ${outflowPeriods.length} outflow periods`);

  // Batch create all outflow_periods
  await batchCreateOutflowPeriods(db, outflowPeriods);

  console.log(`[createOutflowPeriodsFromSource] Successfully created ${outflowPeriods.length} outflow periods`);

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
