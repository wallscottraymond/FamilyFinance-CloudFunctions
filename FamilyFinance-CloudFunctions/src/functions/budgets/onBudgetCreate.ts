/**
 * Budget Periods Auto-Generation (Simplified)
 *
 * This Cloud Function automatically creates budget_periods when a budget is created.
 * It generates periods for all 3 period types (weekly, bi-monthly, monthly) with
 * intelligent time horizon based on budget type.
 *
 * Features:
 * - Multi-period type generation (weekly, bi-monthly, monthly)
 * - Proportional amount calculation based on period duration
 * - Ongoing budgets: 2 years of periods upfront for extended planning
 * - Fixed-end budgets: Periods until end date (capped at 2 years)
 * - Owner-based permissions with family role support
 * - Period ID format matches source periods for frontend compatibility
 *
 * Memory: 512MiB, Timeout: 60s
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import {
  Budget,
  BudgetPeriodDocument,
  PeriodType
} from '../../types';

/**
 * Triggered when a budget is created
 * Automatically generates budget_periods with intelligent time horizon:
 * - Ongoing budgets: 2 years of periods (24 monthly, 48 bi-monthly, 104 weekly)
 * - Fixed-end budgets: Until end date, capped at 2 years maximum
 * - Default: 1 year of periods (12 monthly, 24 bi-monthly, 52 weekly)
 */
export const onBudgetCreate = onDocumentCreated({
  document: 'budgets/{budgetId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const budgetId = event.params.budgetId;
    const budgetData = event.data?.data() as Budget;
    
    if (!budgetData) {
      console.error('No budget data found');
      return;
    }

    console.log(`Creating budget periods for budget: ${budgetId}`);
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    
    // Determine start date - use budget startDate first, then selectedStartPeriod, then current date
    let startDate: Date;
    let startPeriodId: string | undefined;

    if (budgetData.startDate) {
      // Use the budget's specified start date
      startDate = budgetData.startDate.toDate();
      console.log(`Using budget start date: ${startDate.toISOString()}`);
    } else if (budgetData.selectedStartPeriod) {
      // Fallback to selected start period
      const selectedPeriodDoc = await db.collection('source_periods').doc(budgetData.selectedStartPeriod).get();
      if (selectedPeriodDoc.exists) {
        const selectedPeriod = selectedPeriodDoc.data();
        startDate = selectedPeriod!.startDate.toDate();
        startPeriodId = budgetData.selectedStartPeriod;
        console.log(`Using selected start period: ${startPeriodId} (${startDate.toISOString()})`);
      } else {
        console.warn(`Selected start period ${budgetData.selectedStartPeriod} not found, falling back to current date`);
        startDate = new Date();
      }
    } else {
      // Final fallback to current date
      startDate = new Date();
      console.log('No startDate or selectedStartPeriod provided, using current date');
    }
    

    // Determine end date for period generation
    let endDate: Date;

    if (budgetData.isOngoing === false && budgetData.budgetEndDate) {
      // Bounded budget: Use the exact end date specified
      endDate = budgetData.budgetEndDate.toDate();
      console.log(`Bounded budget: Using exact end date: ${endDate.toISOString()}`);
    } else if (budgetData.endDate) {
      // Legacy support: Use the old endDate field if present
      endDate = budgetData.endDate.toDate();
      console.log(`Using legacy endDate field: ${endDate.toISOString()}`);
    } else if (budgetData.isOngoing !== false) {
      // Ongoing budget (isOngoing === true or undefined): Generate 2 years ahead
      endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 24);
      console.log(`Ongoing budget: Creating 2 years of periods ahead: ${endDate.toISOString()}`);
    } else {
      // Default case: generate 1 year of periods
      endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 12);
      console.log(`Default: Creating 1 year of periods: ${endDate.toISOString()}`);
    }

    console.log(`Start date: ${startDate.toISOString()}`);
    console.log(`End date: ${endDate.toISOString()}`);

    // Generate periods directly instead of relying on existing source_periods
    const budgetPeriods: BudgetPeriodDocument[] = [];

    // Generate monthly periods (12 periods)
    console.log('Generating monthly periods...');
    budgetPeriods.push(...generateMonthlyPeriods(budgetId, budgetData, startDate, endDate, now));

    // Generate bi-monthly periods (24 periods - 2 per month)
    console.log('Generating bi-monthly periods...');
    budgetPeriods.push(...generateBiMonthlyPeriods(budgetId, budgetData, startDate, endDate, now));

    // Generate weekly periods (52 periods)
    console.log('Generating weekly periods...');
    budgetPeriods.push(...generateWeeklyPeriods(budgetId, budgetData, startDate, endDate, now));
    
    console.log(`Creating ${budgetPeriods.length} budget periods`);
    
    // Batch create all budget_periods
    await batchCreateBudgetPeriods(db, budgetPeriods);
    
    // Update budget with period range tracking
    const firstPeriod = budgetPeriods.sort((a, b) => 
      a.periodStart.toMillis() - b.periodStart.toMillis()
    )[0];
    
    const lastPeriod = budgetPeriods.sort((a, b) => 
      b.periodStart.toMillis() - a.periodStart.toMillis()
    )[0];
    
    await db.collection('budgets').doc(budgetId).update({
      activePeriodRange: {
        startPeriod: firstPeriod.periodId,
        endPeriod: lastPeriod.periodId,
      },
      lastExtended: now,
    });
    
    console.log(`Successfully created ${budgetPeriods.length} budget periods for budget ${budgetId}`);
    
  } catch (error) {
    console.error('Error in onBudgetCreate:', error);
    // Don't throw - we don't want to break budget creation if period generation fails
  }
});

/**
 * Generate monthly budget periods up to the specified end date
 */
function generateMonthlyPeriods(
  budgetId: string,
  budgetData: Budget,
  startDate: Date,
  endDate: Date,
  now: admin.firestore.Timestamp
): BudgetPeriodDocument[] {
  const periods: BudgetPeriodDocument[] = [];

  let currentDate = new Date(startDate);
  let periodIndex = 0;

  while (currentDate < endDate) {
    const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    // Don't exceed the budget end date
    if (periodStart >= endDate) break;

    // Use format that matches source periods: "2025M01" for January 2025
    const periodId = `${periodStart.getFullYear()}M${String(periodStart.getMonth() + 1).padStart(2, '0')}`;

    periods.push({
      id: `${budgetId}_${periodId}`,
      budgetId: budgetId,
      periodId: periodId,
      sourcePeriodId: periodId,
      familyId: String(budgetData.familyId || ''),
      userId: budgetData.createdBy,
      createdBy: budgetData.createdBy,
      periodType: PeriodType.MONTHLY,
      periodStart: admin.firestore.Timestamp.fromDate(periodStart),
      periodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
      allocatedAmount: budgetData.amount, // Full amount for monthly
      originalAmount: budgetData.amount,
      budgetName: budgetData.name,
      checklistItems: [],
      isModified: false,
      createdAt: now,
      updatedAt: now,
      lastCalculated: now,
      isActive: true,
    });

    currentDate.setMonth(currentDate.getMonth() + 1);
    periodIndex++;
  }

  console.log(`Generated ${periods.length} monthly periods`);
  return periods;
}

/**
 * Generate bi-monthly budget periods up to the specified end date (2 periods per month)
 */
function generateBiMonthlyPeriods(
  budgetId: string,
  budgetData: Budget,
  startDate: Date,
  endDate: Date,
  now: admin.firestore.Timestamp
): BudgetPeriodDocument[] {
  const periods: BudgetPeriodDocument[] = [];

  let currentDate = new Date(startDate);
  let periodIndex = 0;

  while (currentDate < endDate) {
    const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    // First half of month (1st - 15th)
    if (periodIndex % 2 === 0) {
      const periodStart = monthStart;
      const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth(), 15);

      if (periodStart < endDate) {
        // Use format that matches source periods: "2025BM01A" for first half of January 2025
        const periodId = `${periodStart.getFullYear()}BM${String(periodStart.getMonth() + 1).padStart(2, '0')}A`;

        periods.push({
          id: `${budgetId}_${periodId}`,
          budgetId: budgetId,
          periodId: periodId,
          sourcePeriodId: periodId,
          familyId: String(budgetData.familyId || ''),
          userId: budgetData.createdBy,
          createdBy: budgetData.createdBy,
          periodType: PeriodType.BI_MONTHLY,
          periodStart: admin.firestore.Timestamp.fromDate(periodStart),
          periodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
          allocatedAmount: budgetData.amount * 0.5, // Half amount for bi-monthly
          originalAmount: budgetData.amount * 0.5,
          budgetName: budgetData.name,
          checklistItems: [],
          isModified: false,
          createdAt: now,
          updatedAt: now,
          lastCalculated: now,
          isActive: true,
        });
      }
    } else {
      // Second half of month (16th - end of month)
      const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 16);
      const periodEnd = monthEnd;

      if (periodStart < endDate) {
        // Use format that matches source periods: "2025BM01B" for second half of January 2025
        const periodId = `${periodStart.getFullYear()}BM${String(periodStart.getMonth() + 1).padStart(2, '0')}B`;

        periods.push({
          id: `${budgetId}_${periodId}`,
          budgetId: budgetId,
          periodId: periodId,
          sourcePeriodId: periodId,
          familyId: String(budgetData.familyId || ''),
          userId: budgetData.createdBy,
          createdBy: budgetData.createdBy,
          periodType: PeriodType.BI_MONTHLY,
          periodStart: admin.firestore.Timestamp.fromDate(periodStart),
          periodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
          allocatedAmount: budgetData.amount * 0.5, // Half amount for bi-monthly
          originalAmount: budgetData.amount * 0.5,
          budgetName: budgetData.name,
          checklistItems: [],
          isModified: false,
          createdAt: now,
          updatedAt: now,
          lastCalculated: now,
          isActive: true,
        });
      }

      // Move to next month after second half
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    periodIndex++;
  }

  console.log(`Generated ${periods.length} bi-monthly periods`);
  return periods;
}

/**
 * Generate weekly budget periods up to the specified end date
 */
function generateWeeklyPeriods(
  budgetId: string,
  budgetData: Budget,
  startDate: Date,
  endDate: Date,
  now: admin.firestore.Timestamp
): BudgetPeriodDocument[] {
  const periods: BudgetPeriodDocument[] = [];

  // Start from the Monday of the week containing startDate
  let currentDate = new Date(startDate);
  const dayOfWeek = currentDate.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 0 = Sunday, 1 = Monday
  currentDate.setDate(currentDate.getDate() - daysToMonday);

  let weekNumber = 1;

  while (currentDate < endDate) {
    const periodStart = new Date(currentDate);
    const periodEnd = new Date(currentDate);
    periodEnd.setDate(periodEnd.getDate() + 6); // Sunday of the same week

    // Don't exceed the budget end date
    if (periodStart >= endDate) break;

    const year = periodStart.getFullYear();
    const weekOfYear = getWeekOfYear(periodStart);
    // Use format that matches source periods: "2025W01" for week 1 of 2025
    const periodId = `${year}W${String(weekOfYear).padStart(2, '0')}`;

    // Calculate proportional amount based on 7 days vs average month (30.44 days)
    const weeklyAmount = budgetData.amount * (7 / 30.44);

    periods.push({
      id: `${budgetId}_${periodId}`,
      budgetId: budgetId,
      periodId: periodId,
      sourcePeriodId: periodId,
      familyId: String(budgetData.familyId || ''),
      userId: budgetData.createdBy,
      createdBy: budgetData.createdBy,
      periodType: PeriodType.WEEKLY,
      periodStart: admin.firestore.Timestamp.fromDate(periodStart),
      periodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
      allocatedAmount: weeklyAmount,
      originalAmount: weeklyAmount,
      budgetName: budgetData.name,
      checklistItems: [],
      isModified: false,
      createdAt: now,
      updatedAt: now,
      lastCalculated: now,
      isActive: true,
    });

    currentDate.setDate(currentDate.getDate() + 7); // Next Monday
    weekNumber++;
  }

  console.log(`Generated ${periods.length} weekly periods`);
  return periods;
}

/**
 * Get ISO week number of the year (1-53)
 */
function getWeekOfYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}


/**
 * Efficiently create multiple budget_periods using Firestore batch operations
 */
async function batchCreateBudgetPeriods(
  db: admin.firestore.Firestore, 
  budgetPeriods: BudgetPeriodDocument[]
): Promise<void> {
  const BATCH_SIZE = 500; // Firestore batch limit
  
  for (let i = 0; i < budgetPeriods.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchPeriods = budgetPeriods.slice(i, i + BATCH_SIZE);
    
    batchPeriods.forEach((budgetPeriod) => {
      const docRef = db.collection('budget_periods').doc(budgetPeriod.id!);
      batch.set(docRef, budgetPeriod);
    });
    
    await batch.commit();
    console.log(`Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(budgetPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
  }
}