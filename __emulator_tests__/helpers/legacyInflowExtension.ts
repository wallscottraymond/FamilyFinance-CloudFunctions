/**
 * legacyInflowExtension — the per-inflow body of `extendRecurringInflowPeriods` EXACTLY as it was at
 * base 2ae62e6 (copied verbatim from `git show 2ae62e6:src/functions/inflows/orchestration/
 * scheduled/extendRecurringInflowPeriods.ts`: the loop body inside its `try`, and the file's private
 * helpers), wrapped as a function so Top-25 #25 can run the same seed through it and through
 * HEAD's `extendInflowPeriodsFor`. Test-only; never edited except to re-copy from the base.
 */
/* eslint-disable */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { InflowPeriod, SourcePeriod, PlaidRecurringFrequency } from '../../src/types';
import { calculateAllOccurrencesInPeriod } from '../../src/functions/inflows/inflow_periods/utils/calculateAllOccurrencesInPeriod';

export async function legacyExtendInflowPeriodsFor(
  db: admin.firestore.Firestore,
  inflowDoc: admin.firestore.DocumentSnapshot,
  allSourcePeriods: SourcePeriod[],
  now: Timestamp
): Promise<number> {
  let totalPeriodsCreated = 0;
  const inflow = { id: inflowDoc.id, ...inflowDoc.data() } as any;
        console.log(`[extendRecurringInflowPeriods] Processing inflow: ${inflow.description || inflow.merchantName || inflow.id}`);

        // Get existing inflow periods for this inflow
        const existingPeriodsQuery = db.collection('inflow_periods')
          .where('inflowId', '==', inflow.id);

        const existingPeriodsSnapshot = await existingPeriodsQuery.get();
        const existingPeriodIds = new Set(
          existingPeriodsSnapshot.docs.map(doc => doc.data().sourcePeriodId)
        );

        // Calculate payment cycle info
        const cycleInfo = calculatePaymentCycle(inflow);

        // Find missing source periods and create inflow periods
        const newInflowPeriods: InflowPeriod[] = [];

        for (const sourcePeriod of allSourcePeriods) {
          // Skip if inflow period already exists for this source period
          if (existingPeriodIds.has(sourcePeriod.id)) {
            continue;
          }

          // Extract ownership fields
          const userId = inflow.ownerId || inflow.userId;
          const groupId = inflow.groupId || null;

          // Calculate period amounts
          const periodCalc = calculatePeriodAmounts(sourcePeriod, cycleInfo, inflow);

          // Calculate multi-occurrence tracking
          const occurrences = calculateAllOccurrencesInPeriod(inflow, sourcePeriod);

          // Calculate financial totals based on occurrences
          const amountPerOccurrence = cycleInfo.incomeAmount;
          const totalAmountDue = amountPerOccurrence * occurrences.numberOfOccurrences;

          // Initialize occurrence tracking arrays
          const occurrencePaidFlags = new Array(occurrences.numberOfOccurrences).fill(false);
          const occurrenceTransactionIds = new Array(occurrences.numberOfOccurrences).fill(null);

          // Determine first and last expected dates
          const firstDueDateInPeriod = occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[0] : null;
          const lastDueDateInPeriod = occurrences.numberOfOccurrences > 0
            ? occurrences.occurrenceDueDates[occurrences.numberOfOccurrences - 1]
            : null;

          // Build inflow period document
          const inflowPeriodDoc: InflowPeriod = {
            // === IDENTITY ===
            id: `${inflow.id}_${sourcePeriod.id}`,
            inflowId: inflow.id!,
            sourcePeriodId: sourcePeriod.id!,

            // === OWNERSHIP & ACCESS ===
            ownerId: userId,
            createdBy: inflow.createdBy || userId,
            updatedBy: userId,
            groupId: groupId,

            // === PLAID IDENTIFIERS ===
            accountId: inflow.accountId,
            plaidItemId: inflow.plaidItemId,

            // === FINANCIAL TRACKING ===
            actualAmount: null,
            amountWithheld: periodCalc.amountEarned,
            averageAmount: cycleInfo.incomeAmount,
            expectedAmount: totalAmountDue,
            amountPerOccurrence: amountPerOccurrence,
            amountAllocated: occurrences.amountAllocated,
            totalAmountDue: totalAmountDue,
            totalAmountPaid: 0,
            totalAmountUnpaid: totalAmountDue,

            // === TIMESTAMPS ===
            createdAt: now,
            updatedAt: now,
            lastCalculated: now,

            // === PAYMENT CYCLE INFO ===
            currency: inflow.currency || 'USD',
            cycleDays: cycleInfo.cycleDays,
            cycleStartDate: cycleInfo.cycleStartDate,
            cycleEndDate: cycleInfo.cycleEndDate,
            dailyWithholdingRate: periodCalc.amountEarned / getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate),

            // === INFLOW METADATA (Denormalized) ===
            description: inflow.description || null,
            frequency: inflow.frequency,

            // === PAYMENT STATUS ===
            isPaid: false,
            isFullyPaid: false,
            isPartiallyPaid: false,
            isReceiptPeriod: occurrences.numberOfOccurrences > 0,

            // === CATEGORIZATION ===
            internalDetailedCategory: inflow.internalDetailedCategory || null,
            internalPrimaryCategory: inflow.internalPrimaryCategory || null,
            plaidPrimaryCategory: inflow.plaidPrimaryCategory || 'INCOME',
            plaidDetailedCategory: inflow.plaidDetailedCategory || '',

            // === STATUS & CONTROL ===
            isActive: true,
            isHidden: false,

            // === MERCHANT INFO ===
            merchant: inflow.merchantName,
            payee: inflow.merchantName,

            // === PERIOD CONTEXT ===
            periodStartDate: sourcePeriod.startDate,
            periodEndDate: sourcePeriod.endDate,
            periodType: sourcePeriod.type,

            // === PREDICTION ===
            predictedNextDate: occurrences.nextExpectedDate,

            // === USER INTERACTION ===
            rules: [],
            tags: inflow.tags || [],
            type: inflow.type || 'income',
            note: null,
            userCustomName: inflow.userCustomName || null,

            // === SOURCE ===
            source: inflow.source || 'plaid',

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
            paymentProgressPercentage: 0,
            dollarProgressPercentage: 0,

            // === DUE DATE TRACKING ===
            firstDueDateInPeriod: firstDueDateInPeriod,
            lastDueDateInPeriod: lastDueDateInPeriod,
            nextUnpaidDueDate: firstDueDateInPeriod
          } as any;

          newInflowPeriods.push(inflowPeriodDoc);
        }

        // Persist new inflow periods
        if (newInflowPeriods.length > 0) {
          console.log(`[extendRecurringInflowPeriods] Creating ${newInflowPeriods.length} new inflow periods for ${inflow.id}`);
          await batchCreateInflowPeriods(db, newInflowPeriods);
          // No `lastExtended` stamp on the inflow: nothing reads it, the Plaid sync doesn't keep
          // it (so each stamp cost one extra inflow rewrite + trigger on the next sync), and the
          // write itself fired on_inflow_updated.

          totalPeriodsCreated += newInflowPeriods.length;
        } else {
          console.log(`[extendRecurringInflowPeriods] No new periods needed for inflow ${inflow.id}`);
        }
  return totalPeriodsCreated;
}

/**
 * Calculate payment cycle information from inflow data
 */
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

/**
 * Calculate earning amounts for a specific period
 */
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

/**
 * Helper function to calculate days in a period
 */
function getDaysInPeriod(startDate: Timestamp, endDate: Timestamp): number {
  const start = startDate.toDate();
  const end = endDate.toDate();
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Efficiently create multiple inflow_periods using Firestore batch operations
 */
async function batchCreateInflowPeriods(
  db: admin.firestore.Firestore,
  inflowPeriods: InflowPeriod[]
): Promise<void> {
  const BATCH_SIZE = 500;

  for (let i = 0; i < inflowPeriods.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchPeriods = inflowPeriods.slice(i, i + BATCH_SIZE);

    batchPeriods.forEach((inflowPeriod) => {
      const docRef = db.collection('inflow_periods').doc(inflowPeriod.id!);
      batch.set(docRef, inflowPeriod);
    });

    await batch.commit();
    console.log(`[extendRecurringInflowPeriods] Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(inflowPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
  }
}
