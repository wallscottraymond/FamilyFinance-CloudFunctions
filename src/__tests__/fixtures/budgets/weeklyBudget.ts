/**
 * @file weeklyBudget.ts
 * @description Complete test data for a WEEKLY groceries budget scenario
 *
 * SCENARIO:
 * - User has a weekly groceries budget of $150
 * - Budget is ongoing (recurring weekly)
 * - Spans 3 months of historical data
 * - Contains 10 transactions including edge cases
 *
 * EDGE CASES COVERED:
 * - Transaction on period boundary
 * - Refund transaction
 * - Pending transaction
 * - Ignored/excluded transaction
 * - Large purchase exceeding weekly budget
 *
 * USAGE:
 * import { weeklyGroceriesBudget, weeklyGroceriesTransactions } from '../fixtures/budgets/weeklyBudget';
 */

import { BudgetPeriod, PeriodType, TransactionStatus, TransactionType } from '../../../types';
import { TEST_USER, TEST_BUDGET_ID, DEFAULTS } from '../constants';
import { CATEGORIES } from '../categories';
import {
  createTestBudget,
  createTestBudgetPeriod,
  createTestTransaction,
  createTestTransactionSplit,
} from '../factories';
import {
  currentMonthStart,
  currentMonthEnd,
  currentWeekStart,
  currentWeekEnd,
  dayOfCurrentMonth,
  dayOfMonthsAgo,
  monthsAgoStart,
  monthsAgoEnd,
  currentMonthPeriodId,
  currentWeekPeriodId,
  currentBiMonthlyPeriodId,
  monthsAgoPeriodId,
} from '../dateHelpers';

// ============================================================================
// BUDGET DOCUMENT
// ============================================================================

/**
 * Weekly groceries budget - $150/week, ongoing, private
 */
export const weeklyGroceriesBudget = createTestBudget({
  id: TEST_BUDGET_ID.WEEKLY_GROCERIES,
  name: 'Weekly Groceries',
  amount: 150,
  categoryIds: [CATEGORIES.FOOD_GROCERIES],
  period: BudgetPeriod.WEEKLY,
  description: 'Weekly budget for grocery shopping',
  startDate: monthsAgoStart(3),
  alertThreshold: DEFAULTS.ALERT_THRESHOLD,
});

// ============================================================================
// BUDGET PERIODS - WEEKLY (Primary)
// ============================================================================

/** Current week period */
export const weeklyPeriodCurrent = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.WEEKLY_GROCERIES,
  budgetName: 'Weekly Groceries',
  periodType: PeriodType.WEEKLY,
  allocatedAmount: 150,
  periodStart: currentWeekStart(),
  periodEnd: currentWeekEnd(),
});

/** Last week period (with spending) */
export const weeklyPeriodLastWeek = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.WEEKLY_GROCERIES,
  budgetName: 'Weekly Groceries',
  periodType: PeriodType.WEEKLY,
  allocatedAmount: 150,
  spent: 142.50,
});

// ============================================================================
// BUDGET PERIODS - MONTHLY
// ============================================================================

/** Current month period */
export const monthlyPeriodCurrent = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.WEEKLY_GROCERIES,
  budgetName: 'Weekly Groceries',
  periodType: PeriodType.MONTHLY,
  allocatedAmount: 600, // ~4 weeks
  periodStart: currentMonthStart(),
  periodEnd: currentMonthEnd(),
});

/** Last month period */
export const monthlyPeriodLastMonth = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.WEEKLY_GROCERIES,
  budgetName: 'Weekly Groceries',
  periodType: PeriodType.MONTHLY,
  allocatedAmount: 600,
  periodStart: monthsAgoStart(1),
  periodEnd: monthsAgoEnd(1),
  spent: 575.25,
});

/** Two months ago period (over budget) */
export const monthlyPeriodTwoMonthsAgo = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.WEEKLY_GROCERIES,
  budgetName: 'Weekly Groceries',
  periodType: PeriodType.MONTHLY,
  allocatedAmount: 600,
  periodStart: monthsAgoStart(2),
  periodEnd: monthsAgoEnd(2),
  spent: 610.00, // Over budget!
});

// ============================================================================
// BUDGET PERIODS - BI-MONTHLY
// ============================================================================

/** Current bi-monthly period */
export const biMonthlyPeriodCurrent = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.WEEKLY_GROCERIES,
  budgetName: 'Weekly Groceries',
  periodType: PeriodType.BI_MONTHLY,
  allocatedAmount: 300, // ~2 weeks
  periodStart: currentMonthStart(),
  periodEnd: dayOfCurrentMonth(15),
});

// ============================================================================
// ALL BUDGET PERIODS
// ============================================================================

export const weeklyGroceriesBudgetPeriods = [
  weeklyPeriodCurrent,
  weeklyPeriodLastWeek,
  monthlyPeriodCurrent,
  monthlyPeriodLastMonth,
  monthlyPeriodTwoMonthsAgo,
  biMonthlyPeriodCurrent,
];

// ============================================================================
// TRANSACTIONS - CURRENT MONTH
// ============================================================================

/** Transaction 1: Normal grocery purchase - day 3 */
export const txn1_normalPurchase = createTestTransaction({
  transactionId: 'txn_weekly_001',
  amount: 87.52,
  transactionDate: dayOfCurrentMonth(3),
  description: 'Whole Foods - Groceries',
  merchantName: 'Whole Foods',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
});

/** Transaction 2: Small purchase - day 7 */
export const txn2_smallPurchase = createTestTransaction({
  transactionId: 'txn_weekly_002',
  amount: 23.99,
  transactionDate: dayOfCurrentMonth(7),
  description: 'Trader Joes - Groceries',
  merchantName: 'Trader Joes',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
});

/** Transaction 3: Large purchase (exceeds weekly budget) - day 10 */
export const txn3_largePurchase = createTestTransaction({
  transactionId: 'txn_weekly_003',
  amount: 198.45,
  transactionDate: dayOfCurrentMonth(10),
  description: 'Costco - Bulk Groceries',
  merchantName: 'Costco',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
});

/** Transaction 4: REFUND (negative amount effect via isRefund flag) - day 12 */
export const txn4_refund = createTestTransaction({
  transactionId: 'txn_weekly_004',
  amount: 15.00, // Amount is positive, but split.isRefund = true
  transactionDate: dayOfCurrentMonth(12),
  description: 'Whole Foods - Refund',
  merchantName: 'Whole Foods',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
  type: TransactionType.INCOME, // Refunds come back as income
  splits: [
    createTestTransactionSplit({
      splitId: 'txn_weekly_004_split_001',
      amount: 15.00,
      plaidPrimaryCategory: 'FOOD_AND_DRINK',
      plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
      paymentDate: dayOfCurrentMonth(12),
      isRefund: true,
    }),
  ],
});

/** Transaction 5: PENDING transaction - day 14 */
export const txn5_pending = createTestTransaction({
  transactionId: 'txn_weekly_005',
  amount: 45.67,
  transactionDate: dayOfCurrentMonth(14),
  description: 'Safeway - Groceries',
  merchantName: 'Safeway',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
  transactionStatus: TransactionStatus.PENDING,
});

/** Transaction 6: IGNORED transaction - day 15 */
export const txn6_excluded = createTestTransaction({
  transactionId: 'txn_weekly_006',
  amount: 125.00,
  transactionDate: dayOfCurrentMonth(15),
  description: 'Restaurant Depot - Business (excluded)',
  merchantName: 'Restaurant Depot',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
  splits: [
    createTestTransactionSplit({
      splitId: 'txn_weekly_006_split_001',
      amount: 125.00,
      plaidPrimaryCategory: 'FOOD_AND_DRINK',
      plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
      paymentDate: dayOfCurrentMonth(15),
      isIgnored: true,
    }),
  ],
});

// ============================================================================
// TRANSACTIONS - LAST MONTH (Historical)
// ============================================================================

/** Transaction 7: Last month - day 5 */
export const txn7_lastMonth = createTestTransaction({
  transactionId: 'txn_weekly_007',
  amount: 92.33,
  transactionDate: dayOfMonthsAgo(1, 5),
  description: 'Kroger - Groceries',
  merchantName: 'Kroger',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
});

/** Transaction 8: Last month - day 20 */
export const txn8_lastMonth = createTestTransaction({
  transactionId: 'txn_weekly_008',
  amount: 67.89,
  transactionDate: dayOfMonthsAgo(1, 20),
  description: 'Publix - Groceries',
  merchantName: 'Publix',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
});

// ============================================================================
// TRANSACTIONS - TWO MONTHS AGO (Historical)
// ============================================================================

/** Transaction 9: Two months ago - day 10 */
export const txn9_twoMonthsAgo = createTestTransaction({
  transactionId: 'txn_weekly_009',
  amount: 110.00,
  transactionDate: dayOfMonthsAgo(2, 10),
  description: 'Whole Foods - Groceries',
  merchantName: 'Whole Foods',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
});

/** Transaction 10: BOUNDARY - first day of two months ago */
export const txn10_boundaryStart = createTestTransaction({
  transactionId: 'txn_weekly_010',
  amount: 55.00,
  transactionDate: monthsAgoStart(2),
  description: 'Aldi - First day of month (boundary test)',
  merchantName: 'Aldi',
  plaidPrimaryCategory: 'FOOD_AND_DRINK',
  plaidDetailedCategory: CATEGORIES.FOOD_GROCERIES,
});

// ============================================================================
// ALL TRANSACTIONS
// ============================================================================

/** All transactions for the weekly groceries budget */
export const weeklyGroceriesTransactions = [
  txn1_normalPurchase,
  txn2_smallPurchase,
  txn3_largePurchase,
  txn4_refund,
  txn5_pending,
  txn6_excluded,
  txn7_lastMonth,
  txn8_lastMonth,
  txn9_twoMonthsAgo,
  txn10_boundaryStart,
];

/** Only APPROVED, non-ignored transactions (for spending calculations) */
export const weeklyGroceriesActiveTransactions = weeklyGroceriesTransactions.filter(
  (txn) =>
    txn.transactionStatus === TransactionStatus.APPROVED &&
    !txn.splits.some(s => s.isIgnored)
);

/** Current month transactions only */
export const weeklyGroceriesCurrentMonthTransactions = weeklyGroceriesTransactions.filter(
  (txn) => {
    const txnDate = txn.transactionDate.toDate();
    const monthStart = currentMonthStart().toDate();
    const monthEnd = currentMonthEnd().toDate();
    return txnDate >= monthStart && txnDate <= monthEnd;
  }
);

// ============================================================================
// EXPECTED VALUES FOR ASSERTIONS
// ============================================================================

export const weeklyGroceriesExpectedValues = {
  /** Budget amount per week */
  weeklyAmount: 150,
  /** Budget amount per month (~4 weeks) */
  monthlyAmount: 600,
  /** Budget amount per bi-monthly period */
  biMonthlyAmount: 300,
  /** Number of total transactions */
  totalTransactionCount: 10,
  /** Number of active (non-ignored, approved) transactions */
  activeTransactionCount: 7,
  /** Number of current month transactions */
  currentMonthTransactionCount: 6,
  /** Categories in this budget */
  categoryIds: [CATEGORIES.FOOD_GROCERIES],
};
