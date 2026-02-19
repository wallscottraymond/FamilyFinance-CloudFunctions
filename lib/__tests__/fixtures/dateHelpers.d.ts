/**
 * @file dateHelpers.ts
 * @description Dynamic date generators for test data that never goes stale
 *
 * PURPOSE:
 * - Generate dates relative to current time
 * - Ensure tests work regardless of when they run
 * - Provide consistent date patterns for budget periods
 *
 * USAGE:
 * import { currentMonthStart, daysAgo } from '../fixtures/dateHelpers';
 */
import { Timestamp } from 'firebase-admin/firestore';
/** Returns the start of the current month (day 1, 00:00:00) */
export declare const currentMonthStart: () => Timestamp;
/** Returns the end of the current month (last day, 23:59:59) */
export declare const currentMonthEnd: () => Timestamp;
/** Returns the start of the current week (Sunday, 00:00:00) */
export declare const currentWeekStart: () => Timestamp;
/** Returns the end of the current week (Saturday, 23:59:59) */
export declare const currentWeekEnd: () => Timestamp;
/** Returns a date N days ago from today */
export declare const daysAgo: (days: number) => Timestamp;
/** Returns a date N days from today */
export declare const daysFromNow: (days: number) => Timestamp;
/** Returns the start of N months ago */
export declare const monthsAgoStart: (months: number) => Timestamp;
/** Returns the end of N months ago */
export declare const monthsAgoEnd: (months: number) => Timestamp;
/** Returns a specific day of the current month */
export declare const dayOfCurrentMonth: (day: number) => Timestamp;
/** Returns a specific day of N months ago */
export declare const dayOfMonthsAgo: (months: number, day: number) => Timestamp;
/** Generates a monthly period ID for current month (e.g., "2025-M01") */
export declare const currentMonthPeriodId: () => string;
/** Generates a monthly period ID for N months ago */
export declare const monthsAgoPeriodId: (months: number) => string;
/** Generates a weekly period ID for current week (e.g., "2025-W04") */
export declare const currentWeekPeriodId: () => string;
/** Generates a bi-monthly period ID for current bi-monthly period */
export declare const currentBiMonthlyPeriodId: () => string;
/** Returns current timestamp */
export declare const now: () => Timestamp;
/** Converts a Date to Timestamp */
export declare const toTimestamp: (date: Date) => Timestamp;
/** Creates a timestamp from year, month (1-12), day */
export declare const createDate: (year: number, month: number, day: number) => Timestamp;
//# sourceMappingURL=dateHelpers.d.ts.map