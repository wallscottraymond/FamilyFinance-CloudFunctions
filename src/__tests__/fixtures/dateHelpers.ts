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

// ============================================================================
// CURRENT PERIOD HELPERS
// ============================================================================

/** Returns the start of the current month (day 1, 00:00:00) */
export const currentMonthStart = (): Timestamp => {
  const now = new Date();
  return Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0));
};

/** Returns the end of the current month (last day, 23:59:59) */
export const currentMonthEnd = (): Timestamp => {
  const now = new Date();
  return Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
};

/** Returns the start of the current week (Sunday, 00:00:00) */
export const currentWeekStart = (): Timestamp => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() - dayOfWeek;
  return Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0));
};

/** Returns the end of the current week (Saturday, 23:59:59) */
export const currentWeekEnd = (): Timestamp => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = now.getDate() + (6 - dayOfWeek);
  return Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), diff, 23, 59, 59, 999));
};

// ============================================================================
// RELATIVE DATE HELPERS
// ============================================================================

/** Returns a date N days ago from today */
export const daysAgo = (days: number): Timestamp => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return Timestamp.fromDate(date);
};

/** Returns a date N days from today */
export const daysFromNow = (days: number): Timestamp => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return Timestamp.fromDate(date);
};

/** Returns the start of N months ago */
export const monthsAgoStart = (months: number): Timestamp => {
  const now = new Date();
  return Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - months, 1, 0, 0, 0, 0));
};

/** Returns the end of N months ago */
export const monthsAgoEnd = (months: number): Timestamp => {
  const now = new Date();
  return Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - months + 1, 0, 23, 59, 59, 999));
};

/** Returns a specific day of the current month */
export const dayOfCurrentMonth = (day: number): Timestamp => {
  const now = new Date();
  return Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), day, 12, 0, 0, 0));
};

/** Returns a specific day of N months ago */
export const dayOfMonthsAgo = (months: number, day: number): Timestamp => {
  const now = new Date();
  return Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - months, day, 12, 0, 0, 0));
};

// ============================================================================
// PERIOD ID GENERATORS
// ============================================================================

/** Generates a monthly period ID for current month (e.g., "2025-M01") */
export const currentMonthPeriodId = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-M${month}`;
};

/** Generates a monthly period ID for N months ago */
export const monthsAgoPeriodId = (months: number): string => {
  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  return `${targetDate.getFullYear()}-M${month}`;
};

/** Generates a weekly period ID for current week (e.g., "2025-W04") */
export const currentWeekPeriodId = (): string => {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
};

/** Generates a bi-monthly period ID for current bi-monthly period */
export const currentBiMonthlyPeriodId = (): string => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const half = now.getDate() <= 15 ? '1' : '2';
  return `${now.getFullYear()}-M${month}-${half}`;
};

// ============================================================================
// TIMESTAMP UTILITIES
// ============================================================================

/** Returns current timestamp */
export const now = (): Timestamp => Timestamp.now();

/** Converts a Date to Timestamp */
export const toTimestamp = (date: Date): Timestamp => Timestamp.fromDate(date);

/** Creates a timestamp from year, month (1-12), day */
export const createDate = (year: number, month: number, day: number): Timestamp => {
  return Timestamp.fromDate(new Date(year, month - 1, day, 12, 0, 0, 0));
};
