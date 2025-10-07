/**
 * Scheduled Budget Period Maintenance (Simplified)
 *
 * This Cloud Function runs monthly to maintain a rolling 1-year window
 * of budget periods for recurring budgets. Simple and efficient.
 *
 * Features:
 * - Runs on the 1st of each month at 2:00 AM UTC
 * - Maintains 1-year rolling window for recurring budgets
 * - Processes all period types (weekly, bi-monthly, monthly)
 * - Simplified logic with consistent behavior
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import {
  Budget,
  BudgetPeriodDocument,
  SourcePeriod,
  PeriodType
} from '../../../../types';

/**
 * Scheduled function to extend recurring budget periods
 * Runs monthly on the 1st at 2:00 AM UTC
 */
export const extendRecurringBudgetPeriods = onSchedule({
  schedule: '0 2 1 * *', // Cron: minute hour day month dayOfWeek
  timeZone: 'UTC',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (event) => {
  console.log('🚀 Starting scheduled budget period extension...');

  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();

  try {
    // Get all recurring budgets that are ongoing
    const recurringBudgetsQuery = db.collection('budgets')
      .where('budgetType', '==', 'recurring')
      .where('isOngoing', '==', true)
      .where('isActive', '==', true);

    const recurringBudgetsSnapshot = await recurringBudgetsQuery.get();

    if (recurringBudgetsSnapshot.empty) {
      console.log('✅ No recurring budgets found to maintain');
      return;
    }

    console.log(`📊 Found ${recurringBudgetsSnapshot.size} recurring budgets to maintain`);

    let totalPeriodsCreated = 0;
    let budgetsProcessed = 0;

    // Simple rolling window: always maintain 1 year from today
    const today = new Date();
    const oneYearFromToday = new Date(today);
    oneYearFromToday.setMonth(oneYearFromToday.getMonth() + 12);

    console.log(`🎯 Maintaining 1-year window: ${today.toISOString()} to ${oneYearFromToday.toISOString()}`);

    // Get all source periods for the rolling window
    const sourcePeriodsQuery = db.collection('source_periods')
      .where('startDate', '>=', admin.firestore.Timestamp.fromDate(today))
      .where('startDate', '<=', admin.firestore.Timestamp.fromDate(oneYearFromToday));

    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();

    if (sourcePeriodsSnapshot.empty) {
      console.warn('⚠️ No source periods found in rolling window - may need source period generation');
      return;
    }

    console.log(`📋 Found ${sourcePeriodsSnapshot.size} source periods in rolling window`);
    const sourcePeriods = sourcePeriodsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as SourcePeriod));

    // Process each recurring budget
    for (const budgetDoc of recurringBudgetsSnapshot.docs) {
      const budget = { id: budgetDoc.id, ...budgetDoc.data() } as Budget;

      try {
        console.log(`🔄 Processing budget: ${budget.name} (${budget.id})`);

        // Get existing budget periods for this budget
        const existingPeriodsQuery = db.collection('budget_periods')
          .where('budgetId', '==', budget.id);

        const existingPeriodsSnapshot = await existingPeriodsQuery.get();
        const existingPeriodIds = new Set(
          existingPeriodsSnapshot.docs.map(doc => doc.data().sourcePeriodId || doc.data().periodId)
        );

        // Find missing periods in the rolling window
        const newBudgetPeriods: BudgetPeriodDocument[] = [];

        sourcePeriods.forEach((sourcePeriod) => {
          // Skip if budget period already exists
          if (existingPeriodIds.has(sourcePeriod.id)) {
            return;
          }

          // For recurring ongoing budgets, we always create periods in the rolling window
          // No need for complex end date logic since these are ongoing

          // Calculate proportional amount for this period type
          const allocatedAmount = calculateAllocatedAmount(budget.amount, sourcePeriod);

          const budgetPeriod: BudgetPeriodDocument = {
            id: `${budget.id}_${sourcePeriod.id}`,
            budgetId: budget.id!,
            periodId: sourcePeriod.id!,
            sourcePeriodId: sourcePeriod.id!,
            familyId: String(budget.familyId || ''),

            // Ownership
            userId: budget.createdBy,
            createdBy: budget.createdBy,

            // Period context (denormalized for performance)
            periodType: sourcePeriod.type,
            periodStart: sourcePeriod.startDate,
            periodEnd: sourcePeriod.endDate,

            // Budget amounts
            allocatedAmount,
            originalAmount: allocatedAmount,

            // Budget name (denormalized for performance)
            budgetName: budget.name,

            // Checklist items (initially empty)
            checklistItems: [],

            // User modifications (initially none)
            isModified: false,

            // System fields
            createdAt: now,
            updatedAt: now,
            lastCalculated: now,
            isActive: true,
          };

          newBudgetPeriods.push(budgetPeriod);
        });

        if (newBudgetPeriods.length === 0) {
          console.log(`✅ No new periods needed for budget ${budget.id}`);
          budgetsProcessed++;
          continue;
        }

        console.log(`🔨 Creating ${newBudgetPeriods.length} new budget periods for budget ${budget.id}`);

        // Batch create the new budget periods
        await batchCreateBudgetPeriods(db, newBudgetPeriods);

        // Simply update last extended timestamp - no complex range tracking needed
        await db.collection('budgets').doc(budget.id!).update({
          lastExtended: now,
        });

        totalPeriodsCreated += newBudgetPeriods.length;
        budgetsProcessed++;

        console.log(`✅ Successfully extended budget ${budget.id} with ${newBudgetPeriods.length} new periods`);

      } catch (error) {
        console.error(`❌ Error processing budget ${budget.id}:`, error);
        // Continue processing other budgets
      }
    }

    // Log final summary
    console.log(`🎯 Maintenance complete:`);
    console.log(`   - Budgets processed: ${budgetsProcessed}`);
    console.log(`   - Total periods created: ${totalPeriodsCreated}`);

  } catch (error) {
    console.error('❌ Fatal error in scheduled budget period extension:', error);
    throw error; // Re-throw to mark the function execution as failed
  }
});

/**
 * Calculate proportional amount for a budget period based on period type and duration
 */
function calculateAllocatedAmount(baseBudgetAmount: number, sourcePeriod: SourcePeriod): number {
  switch (sourcePeriod.type) {
    case PeriodType.MONTHLY:
      // Full amount for monthly periods
      return baseBudgetAmount;

    case PeriodType.BI_MONTHLY:
      // Half amount for bi-monthly periods (approximately half a month)
      return baseBudgetAmount * 0.5;

    case PeriodType.WEEKLY:
      // Calculate based on actual days in the period vs average month
      const startDate = sourcePeriod.startDate.toDate();
      const endDate = sourcePeriod.endDate.toDate();
      const daysInPeriod = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const averageDaysInMonth = 30.44; // 365.25 / 12

      return baseBudgetAmount * (daysInPeriod / averageDaysInMonth);

    default:
      console.warn(`Unknown period type: ${sourcePeriod.type}`);
      return baseBudgetAmount;
  }
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
    console.log(`📦 Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(budgetPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
  }
}

