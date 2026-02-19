/**
 * @file monthlyBudget.ts
 * @description Complete test data for a MONTHLY entertainment budget scenario
 *
 * SCENARIO:
 * - User has a monthly entertainment budget of $200
 * - Budget covers multiple entertainment categories
 * - Budget is ongoing (recurring monthly)
 * - Spans 3 months of historical data
 * - Contains 9 transactions including edge cases
 *
 * EDGE CASES COVERED:
 * - Multi-category budget
 * - Transaction at end of month (boundary)
 * - Subscription/recurring transaction
 * - Split transaction across categories
 * - Over-budget scenario (last month)
 *
 * USAGE:
 * import { monthlyEntertainmentBudget, monthlyEntertainmentTransactions } from '../fixtures/budgets/monthlyBudget';
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
} from '../dateHelpers';

// ============================================================================
// BUDGET DOCUMENT
// ============================================================================

/**
 * Monthly entertainment budget - $200/month, ongoing, private
 * Multiple categories: TV, Music, Games, Events
 */
export const monthlyEntertainmentBudget = createTestBudget({
  id: TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
  name: 'Entertainment',
  amount: 200,
  categoryIds: [
    CATEGORIES.ENTERTAINMENT_TV,
    CATEGORIES.ENTERTAINMENT_MUSIC,
    CATEGORIES.ENTERTAINMENT_GAMES,
    CATEGORIES.ENTERTAINMENT_EVENTS,
  ],
  period: BudgetPeriod.MONTHLY,
  description: 'Monthly budget for streaming, movies, games, and events',
  startDate: monthsAgoStart(3),
  alertThreshold: DEFAULTS.ALERT_THRESHOLD,
});

// ============================================================================
// BUDGET PERIODS - MONTHLY (Primary)
// ============================================================================

/** Current month period */
export const monthlyPeriodCurrent = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
  budgetName: 'Entertainment',
  periodType: PeriodType.MONTHLY,
  allocatedAmount: 200,
  periodStart: currentMonthStart(),
  periodEnd: currentMonthEnd(),
});

/** Last month period (over budget!) */
export const monthlyPeriodLastMonth = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
  budgetName: 'Entertainment',
  periodType: PeriodType.MONTHLY,
  allocatedAmount: 200,
  periodStart: monthsAgoStart(1),
  periodEnd: monthsAgoEnd(1),
  spent: 245.97, // Over budget!
});

/** Two months ago period */
export const monthlyPeriodTwoMonthsAgo = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
  budgetName: 'Entertainment',
  periodType: PeriodType.MONTHLY,
  allocatedAmount: 200,
  periodStart: monthsAgoStart(2),
  periodEnd: monthsAgoEnd(2),
  spent: 178.50,
});

// ============================================================================
// BUDGET PERIODS - WEEKLY
// ============================================================================

/** Current week period */
export const weeklyPeriodCurrent = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
  budgetName: 'Entertainment',
  periodType: PeriodType.WEEKLY,
  allocatedAmount: 50, // $200/4 weeks
  periodStart: currentWeekStart(),
  periodEnd: currentWeekEnd(),
});

// ============================================================================
// BUDGET PERIODS - BI-MONTHLY
// ============================================================================

/** Current bi-monthly period */
export const biMonthlyPeriodCurrent = createTestBudgetPeriod({
  budgetId: TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
  budgetName: 'Entertainment',
  periodType: PeriodType.BI_MONTHLY,
  allocatedAmount: 100, // $200/2
  periodStart: currentMonthStart(),
  periodEnd: dayOfCurrentMonth(15),
});

// ============================================================================
// ALL BUDGET PERIODS
// ============================================================================

export const monthlyEntertainmentBudgetPeriods = [
  monthlyPeriodCurrent,
  monthlyPeriodLastMonth,
  monthlyPeriodTwoMonthsAgo,
  weeklyPeriodCurrent,
  biMonthlyPeriodCurrent,
];

// ============================================================================
// TRANSACTIONS - CURRENT MONTH
// ============================================================================

/** Transaction 1: Netflix subscription - day 1 (recurring) */
export const txn1_netflixSubscription = createTestTransaction({
  transactionId: 'txn_monthly_001',
  amount: 15.99,
  transactionDate: dayOfCurrentMonth(1),
  description: 'Netflix Monthly Subscription',
  merchantName: 'Netflix',
  plaidPrimaryCategory: 'ENTERTAINMENT',
  plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_TV,
});

/** Transaction 2: Spotify subscription - day 1 (recurring) */
export const txn2_spotifySubscription = createTestTransaction({
  transactionId: 'txn_monthly_002',
  amount: 10.99,
  transactionDate: dayOfCurrentMonth(1),
  description: 'Spotify Premium Monthly',
  merchantName: 'Spotify',
  plaidPrimaryCategory: 'ENTERTAINMENT',
  plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_MUSIC,
});

/** Transaction 3: Movie theater - day 8 */
export const txn3_movieTheater = createTestTransaction({
  transactionId: 'txn_monthly_003',
  amount: 34.50,
  transactionDate: dayOfCurrentMonth(8),
  description: 'AMC Theatres - Movie Night (2 tickets + popcorn)',
  merchantName: 'AMC Theatres',
  plaidPrimaryCategory: 'ENTERTAINMENT',
  plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_TV,
});

/** Transaction 4: Video game purchase - day 12 */
export const txn4_videoGame = createTestTransaction({
  transactionId: 'txn_monthly_004',
  amount: 59.99,
  transactionDate: dayOfCurrentMonth(12),
  description: 'Steam - New Game Purchase',
  merchantName: 'Steam',
  plaidPrimaryCategory: 'ENTERTAINMENT',
  plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_GAMES,
});

/** Transaction 5: Concert tickets - day 15 */
export const txn5_concertTickets = createTestTransaction({
  transactionId: 'txn_monthly_005',
  amount: 85.00,
  transactionDate: dayOfCurrentMonth(15),
  description: 'Ticketmaster - Concert Tickets',
  merchantName: 'Ticketmaster',
  plaidPrimaryCategory: 'ENTERTAINMENT',
  plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_EVENTS,
});

// ============================================================================
// TRANSACTIONS - LAST MONTH (Over budget scenario)
// ============================================================================

/** Transaction 6: Last month - streaming services */
export const txn6_lastMonthStreaming = createTestTransaction({
  transactionId: 'txn_monthly_006',
  amount: 45.97,
  transactionDate: dayOfMonthsAgo(1, 1),
  description: 'Netflix + Disney+ + HBO Max',
  merchantName: 'Various Streaming',
  plaidPrimaryCategory: 'ENTERTAINMENT',
  plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_TV,
});

/** Transaction 7: Last month - theme park (caused over-budget) */
export const txn7_lastMonthThemePark = createTestTransaction({
  transactionId: 'txn_monthly_007',
  amount: 200.00,
  transactionDate: dayOfMonthsAgo(1, 20),
  description: 'Universal Studios - Day Pass',
  merchantName: 'Universal Studios',
  plaidPrimaryCategory: 'ENTERTAINMENT',
  plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_EVENTS,
});

// ============================================================================
// TRANSACTIONS - TWO MONTHS AGO
// ============================================================================

/** Transaction 8: Two months ago - end of month boundary */
export const txn8_boundaryEndOfMonth = createTestTransaction({
  transactionId: 'txn_monthly_008',
  amount: 29.99,
  transactionDate: monthsAgoEnd(2),
  description: 'PlayStation Store - End of month purchase (boundary test)',
  merchantName: 'PlayStation Store',
  plaidPrimaryCategory: 'ENTERTAINMENT',
  plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_GAMES,
});

// ============================================================================
// SPLIT TRANSACTION EXAMPLE
// ============================================================================

/** Transaction 9: Split across multiple entertainment categories */
export const txn9_splitTransaction = createTestTransaction({
  transactionId: 'txn_monthly_009',
  amount: 75.00,
  transactionDate: dayOfCurrentMonth(10),
  description: 'Entertainment Bundle - Split Purchase',
  merchantName: 'Best Buy',
  plaidPrimaryCategory: 'ENTERTAINMENT',
  plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_TV,
  splits: [
    createTestTransactionSplit({
      splitId: 'txn_monthly_009_split_001',
      budgetId: TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
      amount: 30.00,
      plaidPrimaryCategory: 'ENTERTAINMENT',
      plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_TV,
      paymentDate: dayOfCurrentMonth(10),
    }),
    createTestTransactionSplit({
      splitId: 'txn_monthly_009_split_002',
      budgetId: TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
      amount: 45.00,
      plaidPrimaryCategory: 'ENTERTAINMENT',
      plaidDetailedCategory: CATEGORIES.ENTERTAINMENT_GAMES,
      paymentDate: dayOfCurrentMonth(10),
    }),
  ],
});

// ============================================================================
// ALL TRANSACTIONS
// ============================================================================

/** All transactions for the monthly entertainment budget */
export const monthlyEntertainmentTransactions = [
  txn1_netflixSubscription,
  txn2_spotifySubscription,
  txn3_movieTheater,
  txn4_videoGame,
  txn5_concertTickets,
  txn6_lastMonthStreaming,
  txn7_lastMonthThemePark,
  txn8_boundaryEndOfMonth,
  txn9_splitTransaction,
];

/** Current month transactions only */
export const monthlyEntertainmentCurrentMonthTransactions = monthlyEntertainmentTransactions.filter(
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

export const monthlyEntertainmentExpectedValues = {
  /** Budget amount per month */
  monthlyAmount: 200,
  /** Budget amount per week */
  weeklyAmount: 50,
  /** Budget amount per bi-monthly period */
  biMonthlyAmount: 100,
  /** Number of categories in this budget */
  categoryCount: 4,
  /** Number of total transactions */
  totalTransactionCount: 9,
  /** Last month spent (over budget) */
  lastMonthSpent: 245.97,
  /** Last month over-budget amount */
  lastMonthOverBudget: 45.97,
  /** Categories in this budget */
  categoryIds: [
    CATEGORIES.ENTERTAINMENT_TV,
    CATEGORIES.ENTERTAINMENT_MUSIC,
    CATEGORIES.ENTERTAINMENT_GAMES,
    CATEGORIES.ENTERTAINMENT_EVENTS,
  ],
};
