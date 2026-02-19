/**
 * @file budgetTestHelpers.ts
 * @description Helper utilities for budget period tests
 *
 * Provides:
 * - Mock source period creation
 * - Amount calculation verification
 * - Period boundary validation
 * - Sum tolerance checking
 */
import { Timestamp } from 'firebase-admin/firestore';
import { PeriodType, SourcePeriod, Budget, BudgetPeriod } from '../../../../types';
/**
 * Round to 2 decimal places (standard currency rounding)
 * Uses banker's rounding (round half to even) for consistency
 */
export declare function roundToCents(value: number): number;
/**
 * Check if two amounts are equal within tolerance (±$0.01)
 */
export declare function amountsEqual(a: number, b: number, tolerance?: number): boolean;
/**
 * Get number of days in a specific month
 */
export declare function getDaysInMonth(year: number, month: number): number;
/**
 * Create a Timestamp from year, month, day
 */
export declare function createTimestamp(year: number, month: number, day: number): Timestamp;
/**
 * Get days between two timestamps (inclusive)
 * Note: Uses Math.round to handle floating-point precision issues from timezone conversions
 */
export declare function getDaysBetween(start: Timestamp, end: Timestamp): number;
export interface CreateMockSourcePeriodOptions {
    id?: string;
    type: PeriodType;
    year: number;
    month?: number;
    weekNumber?: number;
    biMonthlyHalf?: 1 | 2;
    startDate: Timestamp;
    endDate: Timestamp;
}
/**
 * Create a mock SourcePeriod for testing
 */
export declare function createMockSourcePeriod(options: CreateMockSourcePeriodOptions): SourcePeriod;
/**
 * Create monthly source periods for a given year range
 */
export declare function createMonthlySourcePeriods(startYear: number, startMonth: number, endYear: number, endMonth: number): SourcePeriod[];
/**
 * Create bi-monthly source periods for a given year range
 */
export declare function createBiMonthlySourcePeriods(startYear: number, startMonth: number, endYear: number, endMonth: number): SourcePeriod[];
/**
 * Create weekly source periods for a given date range
 * Note: Weeks start on Sunday (US standard)
 */
export declare function createWeeklySourcePeriods(startDate: Date, endDate: Date): SourcePeriod[];
/**
 * Calculate the expected amount for a period using day-by-day calculation
 * This mirrors the actual implementation logic for validation
 */
export declare function calculateExpectedAmount(budgetAmount: number, budgetPeriodType: PeriodType, targetPeriod: SourcePeriod): number;
/**
 * Calculate daily rate for a month from a monthly budget
 */
export declare function getMonthlyDailyRate(monthlyAmount: number, year: number, month: number): number;
/**
 * Calculate daily rate for a bi-monthly period
 */
export declare function getBiMonthlyDailyRate(biMonthlyAmount: number, year: number, month: number, half: 1 | 2): number;
export interface PeriodAmountSummary {
    periodType: PeriodType;
    totalAmount: number;
    periodCount: number;
    periods: Array<{
        periodId: string;
        amount: number;
        days: number;
    }>;
}
/**
 * Calculate total amounts for each period type
 * Returns summaries for validation that all period types sum to same total
 */
export declare function calculatePeriodTypeTotals(budgetAmount: number, budgetPeriodType: PeriodType, monthlyPeriods: SourcePeriod[], biMonthlyPeriods: SourcePeriod[], weeklyPeriods: SourcePeriod[]): {
    monthly: PeriodAmountSummary;
    biMonthly: PeriodAmountSummary;
    weekly: PeriodAmountSummary;
};
/**
 * Validate that all period type totals are equal within tolerance
 */
export declare function validatePeriodTotalsMatch(summaries: {
    monthly: PeriodAmountSummary;
    biMonthly: PeriodAmountSummary;
    weekly: PeriodAmountSummary;
}, tolerance?: number): {
    isValid: boolean;
    monthlyTotal: number;
    biMonthlyTotal: number;
    weeklyTotal: number;
    maxDifference: number;
    details: string;
};
export interface CreateMockBudgetOptions {
    id?: string;
    name?: string;
    amount: number;
    period: BudgetPeriod;
    startDate: Timestamp;
    endDate?: Timestamp;
    categoryIds?: string[];
    userId?: string;
}
/**
 * Create a mock Budget for testing
 */
export declare function createMockBudget(options: CreateMockBudgetOptions): Budget;
/**
 * User's Example 1: Monthly budget $100 from Feb 1 - March 19
 * Feb: 28 days, $3.57/day
 * March: 31 days, $3.23/day
 */
export declare function createExample1Scenario(): {
    budgetAmount: number;
    budgetPeriodType: PeriodType;
    startDate: Date;
    endDate: Date;
    febDailyRate: number;
    marchDailyRate: number;
    expectedWeeklyPeriods: {
        dates: string;
        days: number;
        expectedAmount: number;
    }[];
    expectedTotal: number;
};
/**
 * User's Example 2: Bi-monthly budget $100/bi-monthly from Feb 1 - April 13
 */
export declare function createExample2Scenario(): {
    budgetAmount: number;
    budgetPeriodType: PeriodType;
    startDate: Date;
    endDate: Date;
    expectedBiMonthlyPeriods: {
        dates: string;
        days: number;
        expectedAmount: number;
    }[];
    expectedMonthlyPeriods: {
        dates: string;
        days: number;
        expectedAmount: number;
    }[];
    expectedTotal: number;
};
/**
 * Leap year February scenario for edge case testing
 */
export declare function createLeapYearScenario(): {
    budgetAmount: number;
    year: number;
    month: number;
    startDate: Date;
    endDate: Date;
    daysInFeb: number;
    dailyRate: number;
    firstHalfDays: number;
    secondHalfDays: number;
};
//# sourceMappingURL=budgetTestHelpers.d.ts.map