"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.weeklyGroceriesExpectedValues = exports.weeklyGroceriesCurrentMonthTransactions = exports.weeklyGroceriesActiveTransactions = exports.weeklyGroceriesTransactions = exports.txn10_boundaryStart = exports.txn9_twoMonthsAgo = exports.txn8_lastMonth = exports.txn7_lastMonth = exports.txn6_excluded = exports.txn5_pending = exports.txn4_refund = exports.txn3_largePurchase = exports.txn2_smallPurchase = exports.txn1_normalPurchase = exports.weeklyGroceriesBudgetPeriods = exports.biMonthlyPeriodCurrent = exports.monthlyPeriodTwoMonthsAgo = exports.monthlyPeriodLastMonth = exports.monthlyPeriodCurrent = exports.weeklyPeriodLastWeek = exports.weeklyPeriodCurrent = exports.weeklyGroceriesBudget = void 0;
const types_1 = require("../../../types");
const constants_1 = require("../constants");
const categories_1 = require("../categories");
const factories_1 = require("../factories");
const dateHelpers_1 = require("../dateHelpers");
// ============================================================================
// BUDGET DOCUMENT
// ============================================================================
/**
 * Weekly groceries budget - $150/week, ongoing, private
 */
exports.weeklyGroceriesBudget = (0, factories_1.createTestBudget)({
    id: constants_1.TEST_BUDGET_ID.WEEKLY_GROCERIES,
    name: 'Weekly Groceries',
    amount: 150,
    categoryIds: [categories_1.CATEGORIES.FOOD_GROCERIES],
    period: types_1.BudgetPeriod.WEEKLY,
    description: 'Weekly budget for grocery shopping',
    startDate: (0, dateHelpers_1.monthsAgoStart)(3),
    alertThreshold: constants_1.DEFAULTS.ALERT_THRESHOLD,
});
// ============================================================================
// BUDGET PERIODS - WEEKLY (Primary)
// ============================================================================
/** Current week period */
exports.weeklyPeriodCurrent = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.WEEKLY_GROCERIES,
    budgetName: 'Weekly Groceries',
    periodType: types_1.PeriodType.WEEKLY,
    allocatedAmount: 150,
    periodStart: (0, dateHelpers_1.currentWeekStart)(),
    periodEnd: (0, dateHelpers_1.currentWeekEnd)(),
});
/** Last week period (with spending) */
exports.weeklyPeriodLastWeek = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.WEEKLY_GROCERIES,
    budgetName: 'Weekly Groceries',
    periodType: types_1.PeriodType.WEEKLY,
    allocatedAmount: 150,
    spent: 142.50,
});
// ============================================================================
// BUDGET PERIODS - MONTHLY
// ============================================================================
/** Current month period */
exports.monthlyPeriodCurrent = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.WEEKLY_GROCERIES,
    budgetName: 'Weekly Groceries',
    periodType: types_1.PeriodType.MONTHLY,
    allocatedAmount: 600, // ~4 weeks
    periodStart: (0, dateHelpers_1.currentMonthStart)(),
    periodEnd: (0, dateHelpers_1.currentMonthEnd)(),
});
/** Last month period */
exports.monthlyPeriodLastMonth = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.WEEKLY_GROCERIES,
    budgetName: 'Weekly Groceries',
    periodType: types_1.PeriodType.MONTHLY,
    allocatedAmount: 600,
    periodStart: (0, dateHelpers_1.monthsAgoStart)(1),
    periodEnd: (0, dateHelpers_1.monthsAgoEnd)(1),
    spent: 575.25,
});
/** Two months ago period (over budget) */
exports.monthlyPeriodTwoMonthsAgo = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.WEEKLY_GROCERIES,
    budgetName: 'Weekly Groceries',
    periodType: types_1.PeriodType.MONTHLY,
    allocatedAmount: 600,
    periodStart: (0, dateHelpers_1.monthsAgoStart)(2),
    periodEnd: (0, dateHelpers_1.monthsAgoEnd)(2),
    spent: 610.00, // Over budget!
});
// ============================================================================
// BUDGET PERIODS - BI-MONTHLY
// ============================================================================
/** Current bi-monthly period */
exports.biMonthlyPeriodCurrent = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.WEEKLY_GROCERIES,
    budgetName: 'Weekly Groceries',
    periodType: types_1.PeriodType.BI_MONTHLY,
    allocatedAmount: 300, // ~2 weeks
    periodStart: (0, dateHelpers_1.currentMonthStart)(),
    periodEnd: (0, dateHelpers_1.dayOfCurrentMonth)(15),
});
// ============================================================================
// ALL BUDGET PERIODS
// ============================================================================
exports.weeklyGroceriesBudgetPeriods = [
    exports.weeklyPeriodCurrent,
    exports.weeklyPeriodLastWeek,
    exports.monthlyPeriodCurrent,
    exports.monthlyPeriodLastMonth,
    exports.monthlyPeriodTwoMonthsAgo,
    exports.biMonthlyPeriodCurrent,
];
// ============================================================================
// TRANSACTIONS - CURRENT MONTH
// ============================================================================
/** Transaction 1: Normal grocery purchase - day 3 */
exports.txn1_normalPurchase = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_001',
    amount: 87.52,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(3),
    description: 'Whole Foods - Groceries',
    merchantName: 'Whole Foods',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
});
/** Transaction 2: Small purchase - day 7 */
exports.txn2_smallPurchase = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_002',
    amount: 23.99,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(7),
    description: 'Trader Joes - Groceries',
    merchantName: 'Trader Joes',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
});
/** Transaction 3: Large purchase (exceeds weekly budget) - day 10 */
exports.txn3_largePurchase = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_003',
    amount: 198.45,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(10),
    description: 'Costco - Bulk Groceries',
    merchantName: 'Costco',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
});
/** Transaction 4: REFUND (negative amount effect via isRefund flag) - day 12 */
exports.txn4_refund = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_004',
    amount: 15.00, // Amount is positive, but split.isRefund = true
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(12),
    description: 'Whole Foods - Refund',
    merchantName: 'Whole Foods',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
    type: types_1.TransactionType.INCOME, // Refunds come back as income
    splits: [
        (0, factories_1.createTestTransactionSplit)({
            splitId: 'txn_weekly_004_split_001',
            amount: 15.00,
            plaidPrimaryCategory: 'FOOD_AND_DRINK',
            plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
            paymentDate: (0, dateHelpers_1.dayOfCurrentMonth)(12),
            isRefund: true,
        }),
    ],
});
/** Transaction 5: PENDING transaction - day 14 */
exports.txn5_pending = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_005',
    amount: 45.67,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(14),
    description: 'Safeway - Groceries',
    merchantName: 'Safeway',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
    transactionStatus: types_1.TransactionStatus.PENDING,
});
/** Transaction 6: IGNORED transaction - day 15 */
exports.txn6_excluded = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_006',
    amount: 125.00,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(15),
    description: 'Restaurant Depot - Business (excluded)',
    merchantName: 'Restaurant Depot',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
    splits: [
        (0, factories_1.createTestTransactionSplit)({
            splitId: 'txn_weekly_006_split_001',
            amount: 125.00,
            plaidPrimaryCategory: 'FOOD_AND_DRINK',
            plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
            paymentDate: (0, dateHelpers_1.dayOfCurrentMonth)(15),
            isIgnored: true,
        }),
    ],
});
// ============================================================================
// TRANSACTIONS - LAST MONTH (Historical)
// ============================================================================
/** Transaction 7: Last month - day 5 */
exports.txn7_lastMonth = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_007',
    amount: 92.33,
    transactionDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 5),
    description: 'Kroger - Groceries',
    merchantName: 'Kroger',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
});
/** Transaction 8: Last month - day 20 */
exports.txn8_lastMonth = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_008',
    amount: 67.89,
    transactionDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 20),
    description: 'Publix - Groceries',
    merchantName: 'Publix',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
});
// ============================================================================
// TRANSACTIONS - TWO MONTHS AGO (Historical)
// ============================================================================
/** Transaction 9: Two months ago - day 10 */
exports.txn9_twoMonthsAgo = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_009',
    amount: 110.00,
    transactionDate: (0, dateHelpers_1.dayOfMonthsAgo)(2, 10),
    description: 'Whole Foods - Groceries',
    merchantName: 'Whole Foods',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
});
/** Transaction 10: BOUNDARY - first day of two months ago */
exports.txn10_boundaryStart = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_weekly_010',
    amount: 55.00,
    transactionDate: (0, dateHelpers_1.monthsAgoStart)(2),
    description: 'Aldi - First day of month (boundary test)',
    merchantName: 'Aldi',
    plaidPrimaryCategory: 'FOOD_AND_DRINK',
    plaidDetailedCategory: categories_1.CATEGORIES.FOOD_GROCERIES,
});
// ============================================================================
// ALL TRANSACTIONS
// ============================================================================
/** All transactions for the weekly groceries budget */
exports.weeklyGroceriesTransactions = [
    exports.txn1_normalPurchase,
    exports.txn2_smallPurchase,
    exports.txn3_largePurchase,
    exports.txn4_refund,
    exports.txn5_pending,
    exports.txn6_excluded,
    exports.txn7_lastMonth,
    exports.txn8_lastMonth,
    exports.txn9_twoMonthsAgo,
    exports.txn10_boundaryStart,
];
/** Only APPROVED, non-ignored transactions (for spending calculations) */
exports.weeklyGroceriesActiveTransactions = exports.weeklyGroceriesTransactions.filter((txn) => txn.transactionStatus === types_1.TransactionStatus.APPROVED &&
    !txn.splits.some(s => s.isIgnored));
/** Current month transactions only */
exports.weeklyGroceriesCurrentMonthTransactions = exports.weeklyGroceriesTransactions.filter((txn) => {
    const txnDate = txn.transactionDate.toDate();
    const monthStart = (0, dateHelpers_1.currentMonthStart)().toDate();
    const monthEnd = (0, dateHelpers_1.currentMonthEnd)().toDate();
    return txnDate >= monthStart && txnDate <= monthEnd;
});
// ============================================================================
// EXPECTED VALUES FOR ASSERTIONS
// ============================================================================
exports.weeklyGroceriesExpectedValues = {
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
    categoryIds: [categories_1.CATEGORIES.FOOD_GROCERIES],
};
//# sourceMappingURL=weeklyBudget.js.map