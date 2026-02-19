/**
 * @file biweeklyBudget.ts
 * @description Complete test data for a BI-WEEKLY transportation budget scenario
 *
 * SCENARIO:
 * - User has a bi-weekly transportation budget of $250
 * - Budget covers gas, parking, rideshares, and tolls
 * - Budget is SHARED (has groupIds)
 * - Spans 3 months of historical data
 * - Contains 10 transactions including edge cases
 *
 * EDGE CASES COVERED:
 * - SHARED budget (group-based access)
 * - Bi-weekly period boundaries
 * - Pending transaction
 * - Credit card transaction (different account)
 * - Split transaction across transportation categories
 *
 * USAGE:
 * import { biweeklyTransportationBudget, biweeklyTransportationTransactions } from '../fixtures/budgets/biweeklyBudget';
 */

import { BudgetPeriod, PeriodType, TransactionStatus, TransactionType } from '../../../types';
import { TEST_USER, TEST_GROUP, TEST_ACCOUNT, TEST_BUDGET_ID, DEFAULTS } from '../constants';
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
} from '../dateHelpers';

// ============================================================================
// BUDGET DOCUMENT
// ============================================================================

/**
 * Bi-weekly transportation budget - $250/bi-weekly, ongoing
 * SHARED budget - has groupIds (visible to group members)
 * Multiple categories: Gas, Parking, Rideshares, Tolls
 */
export const biweeklyTransportationBudget = createTestBudget({
  id: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
  name: 'Transportation',
  amount: 250,
  categoryIds: [
    CATEGORIES.TRANSPORT_GAS,
    CATEGORIES.TRANSPORT_PARKING,
    CATEGORIES.TRANSPORT_RIDESHARE,
    CATEGORIES.TRANSPORT_TOLLS,
  ],
  period: BudgetPeriod.CUSTOM, // Bi-weekly is treated as CUSTOM
  description: 'Bi-weekly budget for gas, parking, and commuting',
  startDate: monthsAgoStart(3),
  alertThreshold: 75, // Lower threshold for earlier warnings
  groupIds: [TEST_GROUP.PRIMARY], // SHARED!
});

// ============================================================================
// BUDGET PERIODS - BI-MONTHLY (Primary for bi-weekly)
// ============================================================================

/** Current bi-monthly period (first half of month) */
export const biMonthlyPeriodCurrentFirst = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
  budgetName: 'Transportation',
  periodType: PeriodType.BI_MONTHLY,
  allocatedAmount: 250,
  periodStart: currentMonthStart(),
  periodEnd: dayOfCurrentMonth(15),
  groupIds: [TEST_GROUP.PRIMARY],
});

/** Current bi-monthly period (second half of month) */
export const biMonthlyPeriodCurrentSecond = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
  budgetName: 'Transportation',
  periodType: PeriodType.BI_MONTHLY,
  allocatedAmount: 250,
  periodStart: dayOfCurrentMonth(16),
  periodEnd: currentMonthEnd(),
  groupIds: [TEST_GROUP.PRIMARY],
});

/** Last month - first half */
export const biMonthlyPeriodLastMonthFirst = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
  budgetName: 'Transportation',
  periodType: PeriodType.BI_MONTHLY,
  allocatedAmount: 250,
  periodStart: monthsAgoStart(1),
  periodEnd: dayOfMonthsAgo(1, 15),
  spent: 235.50,
  groupIds: [TEST_GROUP.PRIMARY],
});

/** Last month - second half */
export const biMonthlyPeriodLastMonthSecond = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
  budgetName: 'Transportation',
  periodType: PeriodType.BI_MONTHLY,
  allocatedAmount: 250,
  periodStart: dayOfMonthsAgo(1, 16),
  periodEnd: monthsAgoEnd(1),
  spent: 198.75,
  groupIds: [TEST_GROUP.PRIMARY],
});

// ============================================================================
// BUDGET PERIODS - MONTHLY
// ============================================================================

/** Current month period */
export const monthlyPeriodCurrent = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
  budgetName: 'Transportation',
  periodType: PeriodType.MONTHLY,
  allocatedAmount: 500, // 2 bi-weekly periods
  periodStart: currentMonthStart(),
  periodEnd: currentMonthEnd(),
  groupIds: [TEST_GROUP.PRIMARY],
});

// ============================================================================
// BUDGET PERIODS - WEEKLY
// ============================================================================

/** Current week period */
export const weeklyPeriodCurrent = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
  budgetName: 'Transportation',
  periodType: PeriodType.WEEKLY,
  allocatedAmount: 125, // $250/2
  periodStart: currentWeekStart(),
  periodEnd: currentWeekEnd(),
  groupIds: [TEST_GROUP.PRIMARY],
});

// ============================================================================
// ALL BUDGET PERIODS
// ============================================================================

export const biweeklyTransportationBudgetPeriods = [
  biMonthlyPeriodCurrentFirst,
  biMonthlyPeriodCurrentSecond,
  biMonthlyPeriodLastMonthFirst,
  biMonthlyPeriodLastMonthSecond,
  monthlyPeriodCurrent,
  weeklyPeriodCurrent,
];

// ============================================================================
// TRANSACTIONS - CURRENT MONTH (First bi-weekly: days 1-15)
// ============================================================================

/** Transaction 1: Gas fill-up - day 2 */
export const txn1_gasFillup = createTestTransaction({
  transactionId: 'txn_biweekly_001',
  amount: 52.47,
  transactionDate: dayOfCurrentMonth(2),
  description: 'Shell Gas Station',
  merchantName: 'Shell',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_GAS,
  groupId: TEST_GROUP.PRIMARY,
});

/** Transaction 2: Parking garage - day 4 */
export const txn2_parkingGarage = createTestTransaction({
  transactionId: 'txn_biweekly_002',
  amount: 25.00,
  transactionDate: dayOfCurrentMonth(4),
  description: 'City Center Parking',
  merchantName: 'City Center Parking',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_PARKING,
  groupId: TEST_GROUP.PRIMARY,
});

/** Transaction 3: Uber ride - day 6 */
export const txn3_uberRide = createTestTransaction({
  transactionId: 'txn_biweekly_003',
  amount: 18.75,
  transactionDate: dayOfCurrentMonth(6),
  description: 'Uber',
  merchantName: 'Uber',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_RIDESHARE,
  groupId: TEST_GROUP.PRIMARY,
});

/** Transaction 4: Toll - day 8 */
export const txn4_toll = createTestTransaction({
  transactionId: 'txn_biweekly_004',
  amount: 3.50,
  transactionDate: dayOfCurrentMonth(8),
  description: 'E-ZPass Toll',
  merchantName: 'E-ZPass',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_TOLLS,
  groupId: TEST_GROUP.PRIMARY,
});

/** Transaction 5: PENDING gas authorization - day 10 */
export const txn5_gasHoldPending = createTestTransaction({
  transactionId: 'txn_biweekly_005',
  amount: 1.00, // Authorization hold
  transactionDate: dayOfCurrentMonth(10),
  description: 'Chevron - Authorization Hold (pending)',
  merchantName: 'Chevron',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_GAS,
  transactionStatus: TransactionStatus.PENDING,
  groupId: TEST_GROUP.PRIMARY,
});

// ============================================================================
// TRANSACTIONS - CURRENT MONTH (Second bi-weekly: days 16-end)
// ============================================================================

/** Transaction 6: Gas (credit card) - day 18 */
export const txn6_gasCreditCard = createTestTransaction({
  transactionId: 'txn_biweekly_006',
  amount: 48.92,
  transactionDate: dayOfCurrentMonth(18),
  description: 'Costco Gas',
  merchantName: 'Costco Gas',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_GAS,
  accountId: TEST_ACCOUNT.CREDIT_CARD, // Different account!
  groupId: TEST_GROUP.PRIMARY,
});

/** Transaction 7: Monthly parking pass - day 20 */
export const txn7_monthlyParking = createTestTransaction({
  transactionId: 'txn_biweekly_007',
  amount: 150.00,
  transactionDate: dayOfCurrentMonth(20),
  description: 'Office Building - Monthly Parking Pass',
  merchantName: 'Office Building Parking',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_PARKING,
  groupId: TEST_GROUP.PRIMARY,
});

// ============================================================================
// TRANSACTIONS - LAST MONTH
// ============================================================================

/** Transaction 8: Last month gas - day 5 */
export const txn8_lastMonthGas = createTestTransaction({
  transactionId: 'txn_biweekly_008',
  amount: 55.00,
  transactionDate: dayOfMonthsAgo(1, 5),
  description: 'BP Gas Station',
  merchantName: 'BP',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_GAS,
  groupId: TEST_GROUP.PRIMARY,
});

/** Transaction 9: Last month Lyft - day 22 */
export const txn9_lastMonthLyft = createTestTransaction({
  transactionId: 'txn_biweekly_009',
  amount: 32.50,
  transactionDate: dayOfMonthsAgo(1, 22),
  description: 'Lyft',
  merchantName: 'Lyft',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_RIDESHARE,
  groupId: TEST_GROUP.PRIMARY,
});

// ============================================================================
// TRANSACTIONS - TWO MONTHS AGO
// ============================================================================

/** Transaction 10: Bi-weekly boundary test (day 15) */
export const txn10_boundaryBiweekly = createTestTransaction({
  transactionId: 'txn_biweekly_010',
  amount: 45.00,
  transactionDate: dayOfMonthsAgo(2, 15),
  description: 'Exxon - Bi-weekly boundary test (day 15)',
  merchantName: 'Exxon',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_GAS,
  groupId: TEST_GROUP.PRIMARY,
});

// ============================================================================
// SPLIT TRANSACTION - Road trip expenses
// ============================================================================

/** Transaction 11: Road trip - split between gas, tolls, parking */
export const txn11_roadTripSplit = createTestTransaction({
  transactionId: 'txn_biweekly_011',
  amount: 125.00,
  transactionDate: dayOfMonthsAgo(1, 10),
  description: 'Road Trip Expenses - Split',
  merchantName: 'Various',
  plaidPrimaryCategory: 'TRANSPORTATION',
  plaidDetailedCategory: CATEGORIES.TRANSPORT_GAS,
  groupId: TEST_GROUP.PRIMARY,
  splits: [
    createTestTransactionSplit({
      splitId: 'txn_biweekly_011_split_001',
      budgetId: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
      amount: 85.00,
      plaidPrimaryCategory: 'TRANSPORTATION',
      plaidDetailedCategory: CATEGORIES.TRANSPORT_GAS,
      paymentDate: dayOfMonthsAgo(1, 10),
    }),
    createTestTransactionSplit({
      splitId: 'txn_biweekly_011_split_002',
      budgetId: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
      amount: 25.00,
      plaidPrimaryCategory: 'TRANSPORTATION',
      plaidDetailedCategory: CATEGORIES.TRANSPORT_TOLLS,
      paymentDate: dayOfMonthsAgo(1, 10),
    }),
    createTestTransactionSplit({
      splitId: 'txn_biweekly_011_split_003',
      budgetId: TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
      amount: 15.00,
      plaidPrimaryCategory: 'TRANSPORTATION',
      plaidDetailedCategory: CATEGORIES.TRANSPORT_PARKING,
      paymentDate: dayOfMonthsAgo(1, 10),
    }),
  ],
});

// ============================================================================
// ALL TRANSACTIONS
// ============================================================================

/** All transactions for the bi-weekly transportation budget */
export const biweeklyTransportationTransactions = [
  txn1_gasFillup,
  txn2_parkingGarage,
  txn3_uberRide,
  txn4_toll,
  txn5_gasHoldPending,
  txn6_gasCreditCard,
  txn7_monthlyParking,
  txn8_lastMonthGas,
  txn9_lastMonthLyft,
  txn10_boundaryBiweekly,
  txn11_roadTripSplit,
];

/** Gas transactions only */
export const biweeklyGasTransactions = biweeklyTransportationTransactions.filter(
  (txn) => txn.plaidDetailedCategory === CATEGORIES.TRANSPORT_GAS
);

/** Transactions from credit card account */
export const biweeklyCreditCardTransactions = biweeklyTransportationTransactions.filter(
  (txn) => txn.accountId === TEST_ACCOUNT.CREDIT_CARD
);

// ============================================================================
// EXPECTED VALUES FOR ASSERTIONS
// ============================================================================

export const biweeklyTransportationExpectedValues = {
  /** Budget amount per bi-weekly period */
  biweeklyAmount: 250,
  /** Budget amount per week */
  weeklyAmount: 125,
  /** Budget amount per month */
  monthlyAmount: 500,
  /** Alert threshold (lower than default) */
  alertThreshold: 75,
  /** Number of categories in this budget */
  categoryCount: 4,
  /** Number of total transactions */
  totalTransactionCount: 11,
  /** Number of gas transactions */
  gasTransactionCount: 4,
  /** Number of split transactions */
  splitTransactionCount: 1,
  /** Number of pending transactions */
  pendingTransactionCount: 1,
  /** Is this a shared budget? */
  isShared: true,
  /** Group ID this budget is shared with */
  sharedGroupId: TEST_GROUP.PRIMARY,
  /** Categories in this budget */
  categoryIds: [
    CATEGORIES.TRANSPORT_GAS,
    CATEGORIES.TRANSPORT_PARKING,
    CATEGORIES.TRANSPORT_RIDESHARE,
    CATEGORIES.TRANSPORT_TOLLS,
  ],
};
