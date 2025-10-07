/**
 * Budget Periods Utility
 *
 * Centralized logic for creating and managing budget periods.
 * Handles the creation of budget_periods from source_periods with proper amount allocation.
 */

import * as admin from 'firebase-admin';
import { Budget, BudgetPeriodDocument, PeriodType, SourcePeriod } from '../../../types';

/**
 * Result of budget period creation
 */
export interface CreateBudgetPeriodsResult {
  budgetPeriods: BudgetPeriodDocument[];
  count: number;
  periodTypeCounts: {
    weekly: number;
    biMonthly: number;
    monthly: number;
  };
  firstPeriodId: string;
  lastPeriodId: string;
}

/**
 * Create budget periods from source periods
 *
 * Queries source_periods collection and creates budget_periods with proper amount allocation:
 * - Monthly: Full budget amount
 * - Bi-Monthly: Half budget amount (50%)
 * - Weekly: Proportional amount (7/30.44 of monthly)
 */
export async function createBudgetPeriodsFromSource(
  db: admin.firestore.Firestore,
  budgetId: string,
  budget: Budget,
  startDate: Date,
  endDate: Date
): Promise<CreateBudgetPeriodsResult> {
  console.log(`[budgetPeriods] Creating budget periods for budget ${budgetId} from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Query source_periods
  const sourcePeriodsQuery = db.collection('source_periods')
    .where('startDate', '>=', admin.firestore.Timestamp.fromDate(startDate))
    .where('startDate', '<=', admin.firestore.Timestamp.fromDate(endDate));

  const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();

  if (sourcePeriodsSnapshot.empty) {
    throw new Error(`No source periods found in date range ${startDate.toISOString()} to ${endDate.toISOString()}. Please run generateSourcePeriods admin function.`);
  }

  console.log(`[budgetPeriods] Found ${sourcePeriodsSnapshot.size} source periods to process`);

  const now = admin.firestore.Timestamp.now();
  const budgetPeriods: BudgetPeriodDocument[] = [];

  const counts = {
    weekly: 0,
    biMonthly: 0,
    monthly: 0,
  };

  // Create budget_periods from source_periods
  sourcePeriodsSnapshot.forEach((doc) => {
    const sourcePeriod = { id: doc.id, ...doc.data() } as SourcePeriod;

    // Calculate allocated amount based on period type
    const allocatedAmount = calculateAllocatedAmount(budget.amount, sourcePeriod.type);

    const budgetPeriod: BudgetPeriodDocument = {
      id: `${budgetId}_${sourcePeriod.periodId}`,
      budgetId: budgetId,
      periodId: sourcePeriod.periodId,
      sourcePeriodId: sourcePeriod.periodId,
      familyId: String(budget.familyId || ''),
      userId: budget.createdBy,
      createdBy: budget.createdBy,
      periodType: sourcePeriod.type,
      periodStart: sourcePeriod.startDate,
      periodEnd: sourcePeriod.endDate,
      allocatedAmount,
      originalAmount: allocatedAmount,
      budgetName: budget.name,
      checklistItems: [],
      isModified: false,
      createdAt: now,
      updatedAt: now,
      lastCalculated: now,
      isActive: true,
    };

    budgetPeriods.push(budgetPeriod);

    // Track counts by period type
    if (sourcePeriod.type === PeriodType.WEEKLY) {
      counts.weekly++;
    } else if (sourcePeriod.type === PeriodType.BI_MONTHLY) {
      counts.biMonthly++;
    } else if (sourcePeriod.type === PeriodType.MONTHLY) {
      counts.monthly++;
    }
  });

  // Sort by period start to get first and last periods
  const sortedPeriods = [...budgetPeriods].sort((a, b) =>
    a.periodStart.toMillis() - b.periodStart.toMillis()
  );

  const result: CreateBudgetPeriodsResult = {
    budgetPeriods,
    count: budgetPeriods.length,
    periodTypeCounts: counts,
    firstPeriodId: sortedPeriods[0].periodId,
    lastPeriodId: sortedPeriods[sortedPeriods.length - 1].periodId,
  };

  console.log(`[budgetPeriods] Created ${result.count} budget periods:`, {
    weekly: counts.weekly,
    biMonthly: counts.biMonthly,
    monthly: counts.monthly,
  });

  return result;
}

/**
 * Calculate allocated amount based on period type
 */
function calculateAllocatedAmount(monthlyAmount: number, periodType: PeriodType): number {
  switch (periodType) {
    case PeriodType.MONTHLY:
      return monthlyAmount; // Full amount for monthly

    case PeriodType.BI_MONTHLY:
      return monthlyAmount * 0.5; // Half amount for bi-monthly

    case PeriodType.WEEKLY:
      return monthlyAmount * (7 / 30.44); // Weekly proportion (7 days / avg month)

    default:
      console.warn(`[budgetPeriods] Unknown period type: ${periodType}, defaulting to full amount`);
      return monthlyAmount;
  }
}

/**
 * Batch create budget periods in Firestore
 *
 * Efficiently creates multiple budget_periods using batch operations.
 * Handles Firestore's 500 document batch limit.
 */
export async function batchCreateBudgetPeriods(
  db: admin.firestore.Firestore,
  budgetPeriods: BudgetPeriodDocument[]
): Promise<void> {
  const BATCH_SIZE = 500; // Firestore batch limit

  console.log(`[budgetPeriods] Batch creating ${budgetPeriods.length} budget periods`);

  for (let i = 0; i < budgetPeriods.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchPeriods = budgetPeriods.slice(i, i + BATCH_SIZE);

    batchPeriods.forEach((budgetPeriod) => {
      const docRef = db.collection('budget_periods').doc(budgetPeriod.id!);
      batch.set(docRef, budgetPeriod);
    });

    await batch.commit();

    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(budgetPeriods.length / BATCH_SIZE);
    console.log(`[budgetPeriods] Created batch ${batchNumber}/${totalBatches} (${batchPeriods.length} periods)`);
  }

  console.log(`[budgetPeriods] Successfully created ${budgetPeriods.length} budget periods`);
}

/**
 * Update budget with period range metadata
 */
export async function updateBudgetPeriodRange(
  db: admin.firestore.Firestore,
  budgetId: string,
  firstPeriodId: string,
  lastPeriodId: string,
  endDate: Date,
  isRecurring: boolean
): Promise<void> {
  const updateData: any = {
    activePeriodRange: {
      startPeriod: firstPeriodId,
      endPeriod: lastPeriodId,
    },
    lastExtended: admin.firestore.Timestamp.now(),
  };

  // Add metadata for recurring budgets to enable future extension
  if (isRecurring) {
    updateData.periodsGeneratedUntil = admin.firestore.Timestamp.fromDate(endDate);
    updateData.canExtendPeriods = true;
    updateData.needsScheduledExtension = true; // Flag for scheduled function
  }

  await db.collection('budgets').doc(budgetId).update(updateData);

  console.log(`[budgetPeriods] Updated budget ${budgetId} with period range:`, {
    startPeriod: firstPeriodId,
    endPeriod: lastPeriodId,
    isRecurring,
  });
}
