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
/**
 * Weekly groceries budget - $150/week, ongoing, private
 */
export declare const weeklyGroceriesBudget: import("../../../types").Budget;
/** Current week period */
export declare const weeklyPeriodCurrent: import("../../../types").BudgetPeriodDocument;
/** Last week period (with spending) */
export declare const weeklyPeriodLastWeek: import("../../../types").BudgetPeriodDocument;
/** Current month period */
export declare const monthlyPeriodCurrent: import("../../../types").BudgetPeriodDocument;
/** Last month period */
export declare const monthlyPeriodLastMonth: import("../../../types").BudgetPeriodDocument;
/** Two months ago period (over budget) */
export declare const monthlyPeriodTwoMonthsAgo: import("../../../types").BudgetPeriodDocument;
/** Current bi-monthly period */
export declare const biMonthlyPeriodCurrent: import("../../../types").BudgetPeriodDocument;
export declare const weeklyGroceriesBudgetPeriods: import("../../../types").BudgetPeriodDocument[];
/** Transaction 1: Normal grocery purchase - day 3 */
export declare const txn1_normalPurchase: import("../../../types").Transaction;
/** Transaction 2: Small purchase - day 7 */
export declare const txn2_smallPurchase: import("../../../types").Transaction;
/** Transaction 3: Large purchase (exceeds weekly budget) - day 10 */
export declare const txn3_largePurchase: import("../../../types").Transaction;
/** Transaction 4: REFUND (negative amount effect via isRefund flag) - day 12 */
export declare const txn4_refund: import("../../../types").Transaction;
/** Transaction 5: PENDING transaction - day 14 */
export declare const txn5_pending: import("../../../types").Transaction;
/** Transaction 6: IGNORED transaction - day 15 */
export declare const txn6_excluded: import("../../../types").Transaction;
/** Transaction 7: Last month - day 5 */
export declare const txn7_lastMonth: import("../../../types").Transaction;
/** Transaction 8: Last month - day 20 */
export declare const txn8_lastMonth: import("../../../types").Transaction;
/** Transaction 9: Two months ago - day 10 */
export declare const txn9_twoMonthsAgo: import("../../../types").Transaction;
/** Transaction 10: BOUNDARY - first day of two months ago */
export declare const txn10_boundaryStart: import("../../../types").Transaction;
/** All transactions for the weekly groceries budget */
export declare const weeklyGroceriesTransactions: import("../../../types").Transaction[];
/** Only APPROVED, non-ignored transactions (for spending calculations) */
export declare const weeklyGroceriesActiveTransactions: import("../../../types").Transaction[];
/** Current month transactions only */
export declare const weeklyGroceriesCurrentMonthTransactions: import("../../../types").Transaction[];
export declare const weeklyGroceriesExpectedValues: {
    /** Budget amount per week */
    weeklyAmount: number;
    /** Budget amount per month (~4 weeks) */
    monthlyAmount: number;
    /** Budget amount per bi-monthly period */
    biMonthlyAmount: number;
    /** Number of total transactions */
    totalTransactionCount: number;
    /** Number of active (non-ignored, approved) transactions */
    activeTransactionCount: number;
    /** Number of current month transactions */
    currentMonthTransactionCount: number;
    /** Categories in this budget */
    categoryIds: "FOOD_AND_DRINK_GROCERIES"[];
};
//# sourceMappingURL=weeklyBudget.d.ts.map