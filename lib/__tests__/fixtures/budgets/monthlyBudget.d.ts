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
/**
 * Monthly entertainment budget - $200/month, ongoing, private
 * Multiple categories: TV, Music, Games, Events
 */
export declare const monthlyEntertainmentBudget: import("../../../types").Budget;
/** Current month period */
export declare const monthlyPeriodCurrent: import("../../../types").BudgetPeriodDocument;
/** Last month period (over budget!) */
export declare const monthlyPeriodLastMonth: import("../../../types").BudgetPeriodDocument;
/** Two months ago period */
export declare const monthlyPeriodTwoMonthsAgo: import("../../../types").BudgetPeriodDocument;
/** Current week period */
export declare const weeklyPeriodCurrent: import("../../../types").BudgetPeriodDocument;
/** Current bi-monthly period */
export declare const biMonthlyPeriodCurrent: import("../../../types").BudgetPeriodDocument;
export declare const monthlyEntertainmentBudgetPeriods: import("../../../types").BudgetPeriodDocument[];
/** Transaction 1: Netflix subscription - day 1 (recurring) */
export declare const txn1_netflixSubscription: import("../../../types").Transaction;
/** Transaction 2: Spotify subscription - day 1 (recurring) */
export declare const txn2_spotifySubscription: import("../../../types").Transaction;
/** Transaction 3: Movie theater - day 8 */
export declare const txn3_movieTheater: import("../../../types").Transaction;
/** Transaction 4: Video game purchase - day 12 */
export declare const txn4_videoGame: import("../../../types").Transaction;
/** Transaction 5: Concert tickets - day 15 */
export declare const txn5_concertTickets: import("../../../types").Transaction;
/** Transaction 6: Last month - streaming services */
export declare const txn6_lastMonthStreaming: import("../../../types").Transaction;
/** Transaction 7: Last month - theme park (caused over-budget) */
export declare const txn7_lastMonthThemePark: import("../../../types").Transaction;
/** Transaction 8: Two months ago - end of month boundary */
export declare const txn8_boundaryEndOfMonth: import("../../../types").Transaction;
/** Transaction 9: Split across multiple entertainment categories */
export declare const txn9_splitTransaction: import("../../../types").Transaction;
/** All transactions for the monthly entertainment budget */
export declare const monthlyEntertainmentTransactions: import("../../../types").Transaction[];
/** Current month transactions only */
export declare const monthlyEntertainmentCurrentMonthTransactions: import("../../../types").Transaction[];
export declare const monthlyEntertainmentExpectedValues: {
    /** Budget amount per month */
    monthlyAmount: number;
    /** Budget amount per week */
    weeklyAmount: number;
    /** Budget amount per bi-monthly period */
    biMonthlyAmount: number;
    /** Number of categories in this budget */
    categoryCount: number;
    /** Number of total transactions */
    totalTransactionCount: number;
    /** Last month spent (over budget) */
    lastMonthSpent: number;
    /** Last month over-budget amount */
    lastMonthOverBudget: number;
    /** Categories in this budget */
    categoryIds: ("ENTERTAINMENT_MUSIC_AND_AUDIO" | "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS" | "ENTERTAINMENT_TV_AND_MOVIES" | "ENTERTAINMENT_VIDEO_GAMES")[];
};
//# sourceMappingURL=monthlyBudget.d.ts.map