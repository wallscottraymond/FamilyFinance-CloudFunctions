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
/**
 * Bi-weekly transportation budget - $250/bi-weekly, ongoing
 * SHARED budget - has groupIds (visible to group members)
 * Multiple categories: Gas, Parking, Rideshares, Tolls
 */
export declare const biweeklyTransportationBudget: import("../../../types").Budget;
/** Current bi-monthly period (first half of month) */
export declare const biMonthlyPeriodCurrentFirst: import("../../../types").BudgetPeriodDocument;
/** Current bi-monthly period (second half of month) */
export declare const biMonthlyPeriodCurrentSecond: import("../../../types").BudgetPeriodDocument;
/** Last month - first half */
export declare const biMonthlyPeriodLastMonthFirst: import("../../../types").BudgetPeriodDocument;
/** Last month - second half */
export declare const biMonthlyPeriodLastMonthSecond: import("../../../types").BudgetPeriodDocument;
/** Current month period */
export declare const monthlyPeriodCurrent: import("../../../types").BudgetPeriodDocument;
/** Current week period */
export declare const weeklyPeriodCurrent: import("../../../types").BudgetPeriodDocument;
export declare const biweeklyTransportationBudgetPeriods: import("../../../types").BudgetPeriodDocument[];
/** Transaction 1: Gas fill-up - day 2 */
export declare const txn1_gasFillup: import("../../../types").Transaction;
/** Transaction 2: Parking garage - day 4 */
export declare const txn2_parkingGarage: import("../../../types").Transaction;
/** Transaction 3: Uber ride - day 6 */
export declare const txn3_uberRide: import("../../../types").Transaction;
/** Transaction 4: Toll - day 8 */
export declare const txn4_toll: import("../../../types").Transaction;
/** Transaction 5: PENDING gas authorization - day 10 */
export declare const txn5_gasHoldPending: import("../../../types").Transaction;
/** Transaction 6: Gas (credit card) - day 18 */
export declare const txn6_gasCreditCard: import("../../../types").Transaction;
/** Transaction 7: Monthly parking pass - day 20 */
export declare const txn7_monthlyParking: import("../../../types").Transaction;
/** Transaction 8: Last month gas - day 5 */
export declare const txn8_lastMonthGas: import("../../../types").Transaction;
/** Transaction 9: Last month Lyft - day 22 */
export declare const txn9_lastMonthLyft: import("../../../types").Transaction;
/** Transaction 10: Bi-weekly boundary test (day 15) */
export declare const txn10_boundaryBiweekly: import("../../../types").Transaction;
/** Transaction 11: Road trip - split between gas, tolls, parking */
export declare const txn11_roadTripSplit: import("../../../types").Transaction;
/** All transactions for the bi-weekly transportation budget */
export declare const biweeklyTransportationTransactions: import("../../../types").Transaction[];
/** Gas transactions only */
export declare const biweeklyGasTransactions: import("../../../types").Transaction[];
/** Transactions from credit card account */
export declare const biweeklyCreditCardTransactions: import("../../../types").Transaction[];
export declare const biweeklyTransportationExpectedValues: {
    /** Budget amount per bi-weekly period */
    biweeklyAmount: number;
    /** Budget amount per week */
    weeklyAmount: number;
    /** Budget amount per month */
    monthlyAmount: number;
    /** Alert threshold (lower than default) */
    alertThreshold: number;
    /** Number of categories in this budget */
    categoryCount: number;
    /** Number of total transactions */
    totalTransactionCount: number;
    /** Number of gas transactions */
    gasTransactionCount: number;
    /** Number of split transactions */
    splitTransactionCount: number;
    /** Number of pending transactions */
    pendingTransactionCount: number;
    /** Is this a shared budget? */
    isShared: boolean;
    /** Group ID this budget is shared with */
    sharedGroupId: "test_group_001";
    /** Categories in this budget */
    categoryIds: ("TRANSPORTATION_GAS" | "TRANSPORTATION_PARKING" | "TRANSPORTATION_TAXIS_AND_RIDE_SHARES" | "TRANSPORTATION_TOLLS")[];
};
//# sourceMappingURL=biweeklyBudget.d.ts.map