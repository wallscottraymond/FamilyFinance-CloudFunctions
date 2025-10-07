/**
 * Budget Periods Auto-Generation
 *
 * This Cloud Function automatically creates budget_periods when a budget is created.
 * It queries the source_periods collection (single source of truth for all periods)
 * and creates budget_periods linked to existing source periods.
 *
 * Features:
 * - Uses source_periods as single source of truth (ensures consistency with outflow_periods)
 * - Multi-period type support (weekly, bi-monthly, monthly)
 * - Proportional amount calculation based on period type:
 *   • Monthly: Full budget amount
 *   • Bi-Monthly: Half budget amount (50%)
 *   • Weekly: Proportional amount (7/30.44 of monthly)
 * - Recurring budgets (budgetType: 'recurring'): 1 year of periods, extended by scheduled function
 * - Limited budgets (budgetType: 'limited'): Periods until specified end date
 * - Owner-based permissions with family role support
 * - Period ID format inherited from source periods for guaranteed consistency
 *
 * Architecture:
 * - Queries source_periods collection instead of generating periods independently
 * - Ensures budget_periods and outflow_periods use identical period definitions
 * - Single point of maintenance for period logic (source_periods generation)
 *
 * Memory: 512MiB, Timeout: 60s
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Budget } from '../../../../types';
import { recalculateBudgetSpendingOnCreate } from '../../utils/budgetSpending';
import {
  determineBudgetPeriodDateRange,
  createBudgetPeriodsFromSource,
  batchCreateBudgetPeriods,
  updateBudgetPeriodRange
} from '../../utils/budgetPeriods';

/**
 * Triggered when a budget is created
 * Automatically generates budget_periods with intelligent time horizon:
 * - Recurring budgets: 1 year of periods (12 monthly, 24 bi-monthly, 52 weekly) + scheduled extension
 * - Limited budgets: Periods until specified end date
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
    console.log(`Budget data:`, {
      budgetType: budgetData.budgetType,
      budgetEndDate: budgetData.budgetEndDate ? budgetData.budgetEndDate.toDate().toISOString() : 'undefined',
      endDate: budgetData.endDate ? budgetData.endDate.toDate().toISOString() : 'undefined',
      startDate: budgetData.startDate ? budgetData.startDate.toDate().toISOString() : 'undefined'
    });

    const db = admin.firestore();

    // Determine date range for budget period generation
    const dateRange = await determineBudgetPeriodDateRange(db, budgetData);
    const { startDate, endDate } = dateRange;

    // Create budget periods from source_periods
    const result = await createBudgetPeriodsFromSource(
      db,
      budgetId,
      budgetData,
      startDate,
      endDate
    );

    // Batch create all budget_periods in Firestore
    await batchCreateBudgetPeriods(db, result.budgetPeriods);

    // Update budget with period range tracking
    await updateBudgetPeriodRange(
      db,
      budgetId,
      result.firstPeriodId,
      result.lastPeriodId,
      endDate,
      budgetData.budgetType === 'recurring'
    );

    console.log(`Successfully created ${result.count} budget periods for budget ${budgetId}`);

    // Recalculate spending from existing transactions that match budget categories
    try {
      console.log(`🔄 Starting spending recalculation for new budget ${budgetId}`);
      const recalcResult = await recalculateBudgetSpendingOnCreate(budgetId, budgetData);

      console.log(`✅ Spending recalculation completed:`, {
        transactionsProcessed: recalcResult.transactionsProcessed,
        totalSpending: recalcResult.totalSpending,
        budgetPeriodsUpdated: recalcResult.budgetPeriodsUpdated,
        periodTypes: recalcResult.periodTypesUpdated
      });
    } catch (recalcError) {
      // Log error but don't fail budget creation
      console.error('❌ Error recalculating budget spending:', recalcError);
    }

  } catch (error) {
    console.error('Error in onBudgetCreate:', error);
    // Don't throw - we don't want to break budget creation if period generation fails
  }
});