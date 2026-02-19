"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthlyEntertainmentExpectedValues = exports.monthlyEntertainmentCurrentMonthTransactions = exports.monthlyEntertainmentTransactions = exports.txn9_splitTransaction = exports.txn8_boundaryEndOfMonth = exports.txn7_lastMonthThemePark = exports.txn6_lastMonthStreaming = exports.txn5_concertTickets = exports.txn4_videoGame = exports.txn3_movieTheater = exports.txn2_spotifySubscription = exports.txn1_netflixSubscription = exports.monthlyEntertainmentBudgetPeriods = exports.biMonthlyPeriodCurrent = exports.weeklyPeriodCurrent = exports.monthlyPeriodTwoMonthsAgo = exports.monthlyPeriodLastMonth = exports.monthlyPeriodCurrent = exports.monthlyEntertainmentBudget = void 0;
const types_1 = require("../../../types");
const constants_1 = require("../constants");
const categories_1 = require("../categories");
const factories_1 = require("../factories");
const dateHelpers_1 = require("../dateHelpers");
// ============================================================================
// BUDGET DOCUMENT
// ============================================================================
/**
 * Monthly entertainment budget - $200/month, ongoing, private
 * Multiple categories: TV, Music, Games, Events
 */
exports.monthlyEntertainmentBudget = (0, factories_1.createTestBudget)({
    id: constants_1.TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
    name: 'Entertainment',
    amount: 200,
    categoryIds: [
        categories_1.CATEGORIES.ENTERTAINMENT_TV,
        categories_1.CATEGORIES.ENTERTAINMENT_MUSIC,
        categories_1.CATEGORIES.ENTERTAINMENT_GAMES,
        categories_1.CATEGORIES.ENTERTAINMENT_EVENTS,
    ],
    period: types_1.BudgetPeriod.MONTHLY,
    description: 'Monthly budget for streaming, movies, games, and events',
    startDate: (0, dateHelpers_1.monthsAgoStart)(3),
    alertThreshold: constants_1.DEFAULTS.ALERT_THRESHOLD,
});
// ============================================================================
// BUDGET PERIODS - MONTHLY (Primary)
// ============================================================================
/** Current month period */
exports.monthlyPeriodCurrent = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
    budgetName: 'Entertainment',
    periodType: types_1.PeriodType.MONTHLY,
    allocatedAmount: 200,
    periodStart: (0, dateHelpers_1.currentMonthStart)(),
    periodEnd: (0, dateHelpers_1.currentMonthEnd)(),
});
/** Last month period (over budget!) */
exports.monthlyPeriodLastMonth = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
    budgetName: 'Entertainment',
    periodType: types_1.PeriodType.MONTHLY,
    allocatedAmount: 200,
    periodStart: (0, dateHelpers_1.monthsAgoStart)(1),
    periodEnd: (0, dateHelpers_1.monthsAgoEnd)(1),
    spent: 245.97, // Over budget!
});
/** Two months ago period */
exports.monthlyPeriodTwoMonthsAgo = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
    budgetName: 'Entertainment',
    periodType: types_1.PeriodType.MONTHLY,
    allocatedAmount: 200,
    periodStart: (0, dateHelpers_1.monthsAgoStart)(2),
    periodEnd: (0, dateHelpers_1.monthsAgoEnd)(2),
    spent: 178.50,
});
// ============================================================================
// BUDGET PERIODS - WEEKLY
// ============================================================================
/** Current week period */
exports.weeklyPeriodCurrent = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
    budgetName: 'Entertainment',
    periodType: types_1.PeriodType.WEEKLY,
    allocatedAmount: 50, // $200/4 weeks
    periodStart: (0, dateHelpers_1.currentWeekStart)(),
    periodEnd: (0, dateHelpers_1.currentWeekEnd)(),
});
// ============================================================================
// BUDGET PERIODS - BI-MONTHLY
// ============================================================================
/** Current bi-monthly period */
exports.biMonthlyPeriodCurrent = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
    budgetName: 'Entertainment',
    periodType: types_1.PeriodType.BI_MONTHLY,
    allocatedAmount: 100, // $200/2
    periodStart: (0, dateHelpers_1.currentMonthStart)(),
    periodEnd: (0, dateHelpers_1.dayOfCurrentMonth)(15),
});
// ============================================================================
// ALL BUDGET PERIODS
// ============================================================================
exports.monthlyEntertainmentBudgetPeriods = [
    exports.monthlyPeriodCurrent,
    exports.monthlyPeriodLastMonth,
    exports.monthlyPeriodTwoMonthsAgo,
    exports.weeklyPeriodCurrent,
    exports.biMonthlyPeriodCurrent,
];
// ============================================================================
// TRANSACTIONS - CURRENT MONTH
// ============================================================================
/** Transaction 1: Netflix subscription - day 1 (recurring) */
exports.txn1_netflixSubscription = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_monthly_001',
    amount: 15.99,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(1),
    description: 'Netflix Monthly Subscription',
    merchantName: 'Netflix',
    plaidPrimaryCategory: 'ENTERTAINMENT',
    plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_TV,
});
/** Transaction 2: Spotify subscription - day 1 (recurring) */
exports.txn2_spotifySubscription = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_monthly_002',
    amount: 10.99,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(1),
    description: 'Spotify Premium Monthly',
    merchantName: 'Spotify',
    plaidPrimaryCategory: 'ENTERTAINMENT',
    plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_MUSIC,
});
/** Transaction 3: Movie theater - day 8 */
exports.txn3_movieTheater = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_monthly_003',
    amount: 34.50,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(8),
    description: 'AMC Theatres - Movie Night (2 tickets + popcorn)',
    merchantName: 'AMC Theatres',
    plaidPrimaryCategory: 'ENTERTAINMENT',
    plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_TV,
});
/** Transaction 4: Video game purchase - day 12 */
exports.txn4_videoGame = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_monthly_004',
    amount: 59.99,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(12),
    description: 'Steam - New Game Purchase',
    merchantName: 'Steam',
    plaidPrimaryCategory: 'ENTERTAINMENT',
    plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_GAMES,
});
/** Transaction 5: Concert tickets - day 15 */
exports.txn5_concertTickets = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_monthly_005',
    amount: 85.00,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(15),
    description: 'Ticketmaster - Concert Tickets',
    merchantName: 'Ticketmaster',
    plaidPrimaryCategory: 'ENTERTAINMENT',
    plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_EVENTS,
});
// ============================================================================
// TRANSACTIONS - LAST MONTH (Over budget scenario)
// ============================================================================
/** Transaction 6: Last month - streaming services */
exports.txn6_lastMonthStreaming = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_monthly_006',
    amount: 45.97,
    transactionDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 1),
    description: 'Netflix + Disney+ + HBO Max',
    merchantName: 'Various Streaming',
    plaidPrimaryCategory: 'ENTERTAINMENT',
    plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_TV,
});
/** Transaction 7: Last month - theme park (caused over-budget) */
exports.txn7_lastMonthThemePark = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_monthly_007',
    amount: 200.00,
    transactionDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 20),
    description: 'Universal Studios - Day Pass',
    merchantName: 'Universal Studios',
    plaidPrimaryCategory: 'ENTERTAINMENT',
    plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_EVENTS,
});
// ============================================================================
// TRANSACTIONS - TWO MONTHS AGO
// ============================================================================
/** Transaction 8: Two months ago - end of month boundary */
exports.txn8_boundaryEndOfMonth = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_monthly_008',
    amount: 29.99,
    transactionDate: (0, dateHelpers_1.monthsAgoEnd)(2),
    description: 'PlayStation Store - End of month purchase (boundary test)',
    merchantName: 'PlayStation Store',
    plaidPrimaryCategory: 'ENTERTAINMENT',
    plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_GAMES,
});
// ============================================================================
// SPLIT TRANSACTION EXAMPLE
// ============================================================================
/** Transaction 9: Split across multiple entertainment categories */
exports.txn9_splitTransaction = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_monthly_009',
    amount: 75.00,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(10),
    description: 'Entertainment Bundle - Split Purchase',
    merchantName: 'Best Buy',
    plaidPrimaryCategory: 'ENTERTAINMENT',
    plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_TV,
    splits: [
        (0, factories_1.createTestTransactionSplit)({
            splitId: 'txn_monthly_009_split_001',
            budgetId: constants_1.TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
            amount: 30.00,
            plaidPrimaryCategory: 'ENTERTAINMENT',
            plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_TV,
            paymentDate: (0, dateHelpers_1.dayOfCurrentMonth)(10),
        }),
        (0, factories_1.createTestTransactionSplit)({
            splitId: 'txn_monthly_009_split_002',
            budgetId: constants_1.TEST_BUDGET_ID.MONTHLY_ENTERTAINMENT,
            amount: 45.00,
            plaidPrimaryCategory: 'ENTERTAINMENT',
            plaidDetailedCategory: categories_1.CATEGORIES.ENTERTAINMENT_GAMES,
            paymentDate: (0, dateHelpers_1.dayOfCurrentMonth)(10),
        }),
    ],
});
// ============================================================================
// ALL TRANSACTIONS
// ============================================================================
/** All transactions for the monthly entertainment budget */
exports.monthlyEntertainmentTransactions = [
    exports.txn1_netflixSubscription,
    exports.txn2_spotifySubscription,
    exports.txn3_movieTheater,
    exports.txn4_videoGame,
    exports.txn5_concertTickets,
    exports.txn6_lastMonthStreaming,
    exports.txn7_lastMonthThemePark,
    exports.txn8_boundaryEndOfMonth,
    exports.txn9_splitTransaction,
];
/** Current month transactions only */
exports.monthlyEntertainmentCurrentMonthTransactions = exports.monthlyEntertainmentTransactions.filter((txn) => {
    const txnDate = txn.transactionDate.toDate();
    const monthStart = (0, dateHelpers_1.currentMonthStart)().toDate();
    const monthEnd = (0, dateHelpers_1.currentMonthEnd)().toDate();
    return txnDate >= monthStart && txnDate <= monthEnd;
});
// ============================================================================
// EXPECTED VALUES FOR ASSERTIONS
// ============================================================================
exports.monthlyEntertainmentExpectedValues = {
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
        categories_1.CATEGORIES.ENTERTAINMENT_TV,
        categories_1.CATEGORIES.ENTERTAINMENT_MUSIC,
        categories_1.CATEGORIES.ENTERTAINMENT_GAMES,
        categories_1.CATEGORIES.ENTERTAINMENT_EVENTS,
    ],
};
//# sourceMappingURL=monthlyBudget.js.map