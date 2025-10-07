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
 * Result of date range determination for budget period generation
 */
export interface BudgetPeriodDateRange {
  startDate: Date;
  endDate: Date;
  startPeriodId?: string;
}

/**
 * Determine the date range for budget period generation
 *
 * This function encapsulates the complex logic for determining when to start
 * and end budget period generation based on budget configuration.
 *
 * @param db - Firestore instance
 * @param budget - Budget blueprint document
 * @returns Date range for period generation
 */
export async function determineBudgetPeriodDateRange(
  db: admin.firestore.Firestore,
  budget: Budget
): Promise<BudgetPeriodDateRange> {
  // Determine start date - use budget startDate first, then selectedStartPeriod, then current date
  let startDate: Date;
  let startPeriodId: string | undefined;

  if (budget.startDate) {
    // Use the budget's specified start date
    startDate = budget.startDate.toDate();
    console.log(`[budgetPeriods] Using budget start date: ${startDate.toISOString()}`);
  } else if (budget.selectedStartPeriod) {
    // Fallback to selected start period
    const selectedPeriodDoc = await db.collection('source_periods').doc(budget.selectedStartPeriod).get();
    if (selectedPeriodDoc.exists) {
      const selectedPeriod = selectedPeriodDoc.data();
      startDate = selectedPeriod!.startDate.toDate();
      startPeriodId = budget.selectedStartPeriod;
      console.log(`[budgetPeriods] Using selected start period: ${startPeriodId} (${startDate.toISOString()})`);
    } else {
      console.warn(`[budgetPeriods] Selected start period ${budget.selectedStartPeriod} not found, falling back to current date`);
      startDate = new Date();
    }
  } else {
    // Final fallback to current date
    startDate = new Date();
    console.log('[budgetPeriods] No startDate or selectedStartPeriod provided, using current date');
  }

  // Determine end date for period generation based on budget type
  let endDate: Date;

  if (budget.budgetType === 'recurring') {
    // Recurring budget: Generate 1 year of periods (will be extended by scheduled function)
    endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 12);
    console.log(`[budgetPeriods] Recurring budget: Creating 1 year of periods until ${endDate.toISOString()}`);
  } else {
    // Limited/non-recurring budget: Use the specified end date
    if (budget.budgetEndDate) {
      endDate = budget.budgetEndDate.toDate();
      console.log(`[budgetPeriods] Limited budget: Using budgetEndDate: ${endDate.toISOString()}`);
    } else if (budget.endDate) {
      endDate = budget.endDate.toDate();
      console.log(`[budgetPeriods] Limited budget: Using legacy endDate: ${endDate.toISOString()}`);
    } else {
      // Default to 1 year if no end date specified
      endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 12);
      console.log(`[budgetPeriods] Limited budget: No end date specified, defaulting to 1 year: ${endDate.toISOString()}`);
    }
  }

  console.log(`[budgetPeriods] Final date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

  return {
    startDate,
    endDate,
    startPeriodId,
  };
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

  // Query source_periods that overlap with the budget date range
  // Use endDate >= startDate to include periods that started before budget creation
  // but are still active (e.g., current month when creating mid-month)
  const sourcePeriodsQuery = db.collection('source_periods')
    .where('endDate', '>=', admin.firestore.Timestamp.fromDate(startDate))
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
      id: `${budgetId}_${doc.id}`,
      budgetId: budgetId,
      periodId: doc.id,
      sourcePeriodId: doc.id,
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

/**
 * Complete workflow for generating budget periods for a new budget
 *
 * This workflow function encapsulates the entire period generation process:
 * 1. Determine date range for period generation
 * 2. Create budget periods from source periods
 * 3. Batch create periods in Firestore
 * 4. Update budget with period range metadata
 *
 * @param db - Firestore instance
 * @param budgetId - Budget document ID
 * @param budget - Budget document data
 * @returns Result of period generation including count and period range
 */
export async function generateBudgetPeriodsForNewBudget(
  db: admin.firestore.Firestore,
  budgetId: string,
  budget: Budget
): Promise<CreateBudgetPeriodsResult> {
  console.log(`[budgetPeriods] Starting complete budget period generation workflow for budget ${budgetId}`);

  // Step 1: Determine date range for budget period generation
  const dateRange = await determineBudgetPeriodDateRange(db, budget);
  const { startDate, endDate } = dateRange;

  // Step 2: Create budget periods from source_periods
  const result = await createBudgetPeriodsFromSource(
    db,
    budgetId,
    budget,
    startDate,
    endDate
  );

  // Step 3: Batch create all budget_periods in Firestore
  await batchCreateBudgetPeriods(db, result.budgetPeriods);

  // Step 4: Update budget with period range tracking
  await updateBudgetPeriodRange(
    db,
    budgetId,
    result.firstPeriodId,
    result.lastPeriodId,
    endDate,
    budget.budgetType === 'recurring'
  );

  console.log(`[budgetPeriods] Completed budget period generation workflow for budget ${budgetId}:`, {
    totalPeriods: result.count,
    periodRange: `${result.firstPeriodId} to ${result.lastPeriodId}`,
    periodCounts: result.periodTypeCounts,
  });

  return result;
}
