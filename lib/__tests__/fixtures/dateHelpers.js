"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDate = exports.toTimestamp = exports.now = exports.currentBiMonthlyPeriodId = exports.currentWeekPeriodId = exports.monthsAgoPeriodId = exports.currentMonthPeriodId = exports.dayOfMonthsAgo = exports.dayOfCurrentMonth = exports.monthsAgoEnd = exports.monthsAgoStart = exports.daysFromNow = exports.daysAgo = exports.currentWeekEnd = exports.currentWeekStart = exports.currentMonthEnd = exports.currentMonthStart = void 0;
const firestore_1 = require("firebase-admin/firestore");
// ============================================================================
// CURRENT PERIOD HELPERS
// ============================================================================
/** Returns the start of the current month (day 1, 00:00:00) */
const currentMonthStart = () => {
    const now = new Date();
    return firestore_1.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0));
};
exports.currentMonthStart = currentMonthStart;
/** Returns the end of the current month (last day, 23:59:59) */
const currentMonthEnd = () => {
    const now = new Date();
    return firestore_1.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
};
exports.currentMonthEnd = currentMonthEnd;
/** Returns the start of the current week (Sunday, 00:00:00) */
const currentWeekStart = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek;
    return firestore_1.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0));
};
exports.currentWeekStart = currentWeekStart;
/** Returns the end of the current week (Saturday, 23:59:59) */
const currentWeekEnd = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diff = now.getDate() + (6 - dayOfWeek);
    return firestore_1.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), diff, 23, 59, 59, 999));
};
exports.currentWeekEnd = currentWeekEnd;
// ============================================================================
// RELATIVE DATE HELPERS
// ============================================================================
/** Returns a date N days ago from today */
const daysAgo = (days) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return firestore_1.Timestamp.fromDate(date);
};
exports.daysAgo = daysAgo;
/** Returns a date N days from today */
const daysFromNow = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return firestore_1.Timestamp.fromDate(date);
};
exports.daysFromNow = daysFromNow;
/** Returns the start of N months ago */
const monthsAgoStart = (months) => {
    const now = new Date();
    return firestore_1.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - months, 1, 0, 0, 0, 0));
};
exports.monthsAgoStart = monthsAgoStart;
/** Returns the end of N months ago */
const monthsAgoEnd = (months) => {
    const now = new Date();
    return firestore_1.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - months + 1, 0, 23, 59, 59, 999));
};
exports.monthsAgoEnd = monthsAgoEnd;
/** Returns a specific day of the current month */
const dayOfCurrentMonth = (day) => {
    const now = new Date();
    return firestore_1.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth(), day, 12, 0, 0, 0));
};
exports.dayOfCurrentMonth = dayOfCurrentMonth;
/** Returns a specific day of N months ago */
const dayOfMonthsAgo = (months, day) => {
    const now = new Date();
    return firestore_1.Timestamp.fromDate(new Date(now.getFullYear(), now.getMonth() - months, day, 12, 0, 0, 0));
};
exports.dayOfMonthsAgo = dayOfMonthsAgo;
// ============================================================================
// PERIOD ID GENERATORS
// ============================================================================
/** Generates a monthly period ID for current month (e.g., "2025-M01") */
const currentMonthPeriodId = () => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-M${month}`;
};
exports.currentMonthPeriodId = currentMonthPeriodId;
/** Generates a monthly period ID for N months ago */
const monthsAgoPeriodId = (months) => {
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() - months, 1);
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    return `${targetDate.getFullYear()}-M${month}`;
};
exports.monthsAgoPeriodId = monthsAgoPeriodId;
/** Generates a weekly period ID for current week (e.g., "2025-W04") */
const currentWeekPeriodId = () => {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
};
exports.currentWeekPeriodId = currentWeekPeriodId;
/** Generates a bi-monthly period ID for current bi-monthly period */
const currentBiMonthlyPeriodId = () => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const half = now.getDate() <= 15 ? '1' : '2';
    return `${now.getFullYear()}-M${month}-${half}`;
};
exports.currentBiMonthlyPeriodId = currentBiMonthlyPeriodId;
// ============================================================================
// TIMESTAMP UTILITIES
// ============================================================================
/** Returns current timestamp */
const now = () => firestore_1.Timestamp.now();
exports.now = now;
/** Converts a Date to Timestamp */
const toTimestamp = (date) => firestore_1.Timestamp.fromDate(date);
exports.toTimestamp = toTimestamp;
/** Creates a timestamp from year, month (1-12), day */
const createDate = (year, month, day) => {
    return firestore_1.Timestamp.fromDate(new Date(year, month - 1, day, 12, 0, 0, 0));
};
exports.createDate = createDate;
//# sourceMappingURL=dateHelpers.js.map