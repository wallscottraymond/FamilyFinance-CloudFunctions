"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.biweeklyTransportationExpectedValues = exports.biweeklyCreditCardTransactions = exports.biweeklyGasTransactions = exports.biweeklyTransportationTransactions = exports.txn11_roadTripSplit = exports.txn10_boundaryBiweekly = exports.txn9_lastMonthLyft = exports.txn8_lastMonthGas = exports.txn7_monthlyParking = exports.txn6_gasCreditCard = exports.txn5_gasHoldPending = exports.txn4_toll = exports.txn3_uberRide = exports.txn2_parkingGarage = exports.txn1_gasFillup = exports.biweeklyTransportationBudgetPeriods = exports.weeklyPeriodCurrent = exports.monthlyPeriodCurrent = exports.biMonthlyPeriodLastMonthSecond = exports.biMonthlyPeriodLastMonthFirst = exports.biMonthlyPeriodCurrentSecond = exports.biMonthlyPeriodCurrentFirst = exports.biweeklyTransportationBudget = void 0;
const types_1 = require("../../../types");
const constants_1 = require("../constants");
const categories_1 = require("../categories");
const factories_1 = require("../factories");
const dateHelpers_1 = require("../dateHelpers");
// ============================================================================
// BUDGET DOCUMENT
// ============================================================================
/**
 * Bi-weekly transportation budget - $250/bi-weekly, ongoing
 * SHARED budget - has groupIds (visible to group members)
 * Multiple categories: Gas, Parking, Rideshares, Tolls
 */
exports.biweeklyTransportationBudget = (0, factories_1.createTestBudget)({
    id: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
    name: 'Transportation',
    amount: 250,
    categoryIds: [
        categories_1.CATEGORIES.TRANSPORT_GAS,
        categories_1.CATEGORIES.TRANSPORT_PARKING,
        categories_1.CATEGORIES.TRANSPORT_RIDESHARE,
        categories_1.CATEGORIES.TRANSPORT_TOLLS,
    ],
    period: types_1.BudgetPeriod.CUSTOM, // Bi-weekly is treated as CUSTOM
    description: 'Bi-weekly budget for gas, parking, and commuting',
    startDate: (0, dateHelpers_1.monthsAgoStart)(3),
    alertThreshold: 75, // Lower threshold for earlier warnings
    groupIds: [constants_1.TEST_GROUP.PRIMARY], // SHARED!
});
// ============================================================================
// BUDGET PERIODS - BI-MONTHLY (Primary for bi-weekly)
// ============================================================================
/** Current bi-monthly period (first half of month) */
exports.biMonthlyPeriodCurrentFirst = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
    budgetName: 'Transportation',
    periodType: types_1.PeriodType.BI_MONTHLY,
    allocatedAmount: 250,
    periodStart: (0, dateHelpers_1.currentMonthStart)(),
    periodEnd: (0, dateHelpers_1.dayOfCurrentMonth)(15),
    groupIds: [constants_1.TEST_GROUP.PRIMARY],
});
/** Current bi-monthly period (second half of month) */
exports.biMonthlyPeriodCurrentSecond = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
    budgetName: 'Transportation',
    periodType: types_1.PeriodType.BI_MONTHLY,
    allocatedAmount: 250,
    periodStart: (0, dateHelpers_1.dayOfCurrentMonth)(16),
    periodEnd: (0, dateHelpers_1.currentMonthEnd)(),
    groupIds: [constants_1.TEST_GROUP.PRIMARY],
});
/** Last month - first half */
exports.biMonthlyPeriodLastMonthFirst = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
    budgetName: 'Transportation',
    periodType: types_1.PeriodType.BI_MONTHLY,
    allocatedAmount: 250,
    periodStart: (0, dateHelpers_1.monthsAgoStart)(1),
    periodEnd: (0, dateHelpers_1.dayOfMonthsAgo)(1, 15),
    spent: 235.50,
    groupIds: [constants_1.TEST_GROUP.PRIMARY],
});
/** Last month - second half */
exports.biMonthlyPeriodLastMonthSecond = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
    budgetName: 'Transportation',
    periodType: types_1.PeriodType.BI_MONTHLY,
    allocatedAmount: 250,
    periodStart: (0, dateHelpers_1.dayOfMonthsAgo)(1, 16),
    periodEnd: (0, dateHelpers_1.monthsAgoEnd)(1),
    spent: 198.75,
    groupIds: [constants_1.TEST_GROUP.PRIMARY],
});
// ============================================================================
// BUDGET PERIODS - MONTHLY
// ============================================================================
/** Current month period */
exports.monthlyPeriodCurrent = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
    budgetName: 'Transportation',
    periodType: types_1.PeriodType.MONTHLY,
    allocatedAmount: 500, // 2 bi-weekly periods
    periodStart: (0, dateHelpers_1.currentMonthStart)(),
    periodEnd: (0, dateHelpers_1.currentMonthEnd)(),
    groupIds: [constants_1.TEST_GROUP.PRIMARY],
});
// ============================================================================
// BUDGET PERIODS - WEEKLY
// ============================================================================
/** Current week period */
exports.weeklyPeriodCurrent = (0, factories_1.createTestBudgetPeriod)({
    budgetId: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
    budgetName: 'Transportation',
    periodType: types_1.PeriodType.WEEKLY,
    allocatedAmount: 125, // $250/2
    periodStart: (0, dateHelpers_1.currentWeekStart)(),
    periodEnd: (0, dateHelpers_1.currentWeekEnd)(),
    groupIds: [constants_1.TEST_GROUP.PRIMARY],
});
// ============================================================================
// ALL BUDGET PERIODS
// ============================================================================
exports.biweeklyTransportationBudgetPeriods = [
    exports.biMonthlyPeriodCurrentFirst,
    exports.biMonthlyPeriodCurrentSecond,
    exports.biMonthlyPeriodLastMonthFirst,
    exports.biMonthlyPeriodLastMonthSecond,
    exports.monthlyPeriodCurrent,
    exports.weeklyPeriodCurrent,
];
// ============================================================================
// TRANSACTIONS - CURRENT MONTH (First bi-weekly: days 1-15)
// ============================================================================
/** Transaction 1: Gas fill-up - day 2 */
exports.txn1_gasFillup = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_001',
    amount: 52.47,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(2),
    description: 'Shell Gas Station',
    merchantName: 'Shell',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_GAS,
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
/** Transaction 2: Parking garage - day 4 */
exports.txn2_parkingGarage = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_002',
    amount: 25.00,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(4),
    description: 'City Center Parking',
    merchantName: 'City Center Parking',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_PARKING,
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
/** Transaction 3: Uber ride - day 6 */
exports.txn3_uberRide = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_003',
    amount: 18.75,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(6),
    description: 'Uber',
    merchantName: 'Uber',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_RIDESHARE,
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
/** Transaction 4: Toll - day 8 */
exports.txn4_toll = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_004',
    amount: 3.50,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(8),
    description: 'E-ZPass Toll',
    merchantName: 'E-ZPass',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_TOLLS,
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
/** Transaction 5: PENDING gas authorization - day 10 */
exports.txn5_gasHoldPending = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_005',
    amount: 1.00, // Authorization hold
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(10),
    description: 'Chevron - Authorization Hold (pending)',
    merchantName: 'Chevron',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_GAS,
    transactionStatus: types_1.TransactionStatus.PENDING,
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
// ============================================================================
// TRANSACTIONS - CURRENT MONTH (Second bi-weekly: days 16-end)
// ============================================================================
/** Transaction 6: Gas (credit card) - day 18 */
exports.txn6_gasCreditCard = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_006',
    amount: 48.92,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(18),
    description: 'Costco Gas',
    merchantName: 'Costco Gas',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_GAS,
    accountId: constants_1.TEST_ACCOUNT.CREDIT_CARD, // Different account!
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
/** Transaction 7: Monthly parking pass - day 20 */
exports.txn7_monthlyParking = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_007',
    amount: 150.00,
    transactionDate: (0, dateHelpers_1.dayOfCurrentMonth)(20),
    description: 'Office Building - Monthly Parking Pass',
    merchantName: 'Office Building Parking',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_PARKING,
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
// ============================================================================
// TRANSACTIONS - LAST MONTH
// ============================================================================
/** Transaction 8: Last month gas - day 5 */
exports.txn8_lastMonthGas = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_008',
    amount: 55.00,
    transactionDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 5),
    description: 'BP Gas Station',
    merchantName: 'BP',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_GAS,
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
/** Transaction 9: Last month Lyft - day 22 */
exports.txn9_lastMonthLyft = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_009',
    amount: 32.50,
    transactionDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 22),
    description: 'Lyft',
    merchantName: 'Lyft',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_RIDESHARE,
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
// ============================================================================
// TRANSACTIONS - TWO MONTHS AGO
// ============================================================================
/** Transaction 10: Bi-weekly boundary test (day 15) */
exports.txn10_boundaryBiweekly = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_010',
    amount: 45.00,
    transactionDate: (0, dateHelpers_1.dayOfMonthsAgo)(2, 15),
    description: 'Exxon - Bi-weekly boundary test (day 15)',
    merchantName: 'Exxon',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_GAS,
    groupId: constants_1.TEST_GROUP.PRIMARY,
});
// ============================================================================
// SPLIT TRANSACTION - Road trip expenses
// ============================================================================
/** Transaction 11: Road trip - split between gas, tolls, parking */
exports.txn11_roadTripSplit = (0, factories_1.createTestTransaction)({
    transactionId: 'txn_biweekly_011',
    amount: 125.00,
    transactionDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 10),
    description: 'Road Trip Expenses - Split',
    merchantName: 'Various',
    plaidPrimaryCategory: 'TRANSPORTATION',
    plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_GAS,
    groupId: constants_1.TEST_GROUP.PRIMARY,
    splits: [
        (0, factories_1.createTestTransactionSplit)({
            splitId: 'txn_biweekly_011_split_001',
            budgetId: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
            amount: 85.00,
            plaidPrimaryCategory: 'TRANSPORTATION',
            plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_GAS,
            paymentDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 10),
        }),
        (0, factories_1.createTestTransactionSplit)({
            splitId: 'txn_biweekly_011_split_002',
            budgetId: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
            amount: 25.00,
            plaidPrimaryCategory: 'TRANSPORTATION',
            plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_TOLLS,
            paymentDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 10),
        }),
        (0, factories_1.createTestTransactionSplit)({
            splitId: 'txn_biweekly_011_split_003',
            budgetId: constants_1.TEST_BUDGET_ID.BIWEEKLY_TRANSPORTATION,
            amount: 15.00,
            plaidPrimaryCategory: 'TRANSPORTATION',
            plaidDetailedCategory: categories_1.CATEGORIES.TRANSPORT_PARKING,
            paymentDate: (0, dateHelpers_1.dayOfMonthsAgo)(1, 10),
        }),
    ],
});
// ============================================================================
// ALL TRANSACTIONS
// ============================================================================
/** All transactions for the bi-weekly transportation budget */
exports.biweeklyTransportationTransactions = [
    exports.txn1_gasFillup,
    exports.txn2_parkingGarage,
    exports.txn3_uberRide,
    exports.txn4_toll,
    exports.txn5_gasHoldPending,
    exports.txn6_gasCreditCard,
    exports.txn7_monthlyParking,
    exports.txn8_lastMonthGas,
    exports.txn9_lastMonthLyft,
    exports.txn10_boundaryBiweekly,
    exports.txn11_roadTripSplit,
];
/** Gas transactions only */
exports.biweeklyGasTransactions = exports.biweeklyTransportationTransactions.filter((txn) => txn.plaidDetailedCategory === categories_1.CATEGORIES.TRANSPORT_GAS);
/** Transactions from credit card account */
exports.biweeklyCreditCardTransactions = exports.biweeklyTransportationTransactions.filter((txn) => txn.accountId === constants_1.TEST_ACCOUNT.CREDIT_CARD);
// ============================================================================
// EXPECTED VALUES FOR ASSERTIONS
// ============================================================================
exports.biweeklyTransportationExpectedValues = {
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
    sharedGroupId: constants_1.TEST_GROUP.PRIMARY,
    /** Categories in this budget */
    categoryIds: [
        categories_1.CATEGORIES.TRANSPORT_GAS,
        categories_1.CATEGORIES.TRANSPORT_PARKING,
        categories_1.CATEGORIES.TRANSPORT_RIDESHARE,
        categories_1.CATEGORIES.TRANSPORT_TOLLS,
    ],
};
//# sourceMappingURL=biweeklyBudget.js.map