"use strict";
/**
 * Calculate All Occurrences In Period (Inflows)
 *
 * Determines how many times an income is expected within a given period.
 * Generates occurrence details including due dates.
 *
 * Examples:
 * - Bi-weekly salary in monthly period: 2-3 occurrences
 * - Weekly income in monthly period: 4-5 occurrences
 * - Monthly salary in monthly period: 1 occurrence (if due date in period)
 *
 * NOTE: Plaid amounts for inflows are NEGATIVE (money coming IN).
 * We store and return all amounts as POSITIVE values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateAllOccurrencesInPeriod = calculateAllOccurrencesInPeriod;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const outflow_period_service_1 = require("../../../domain/outflows/outflow_period.service");
/**
 * Get approximate cycle days for a frequency
 */
function getCycleDays(frequency) {
    switch (frequency) {
        case types_1.PlaidRecurringFrequency.WEEKLY:
        case 'WEEKLY':
            return 7;
        case types_1.PlaidRecurringFrequency.BIWEEKLY:
        case 'BIWEEKLY':
            return 14;
        case types_1.PlaidRecurringFrequency.SEMI_MONTHLY:
        case 'SEMI_MONTHLY':
            return 15; // Approximate
        case types_1.PlaidRecurringFrequency.MONTHLY:
        case 'MONTHLY':
            return 30; // Approximate
        case 'QUARTERLY':
            return 91; // Approximate (365/4)
        case types_1.PlaidRecurringFrequency.ANNUALLY:
        case 'ANNUALLY':
            return 365;
        default:
            return 30; // Default to monthly
    }
}
/**
 * Get number of days in a period
 */
function getPeriodDays(periodStart, periodEnd) {
    return Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
/**
 * Calculate all income occurrences within a given period
 *
 * This function determines how many times an income is expected within
 * a period and calculates the due dates for each occurrence.
 *
 * @param inflow - The recurring income definition
 * @param sourcePeriod - The period to calculate occurrences for
 * @returns OccurrenceResult with occurrence count, dates, and total amount
 *
 * @example
 * ```typescript
 * // Weekly income ($500) in monthly period (Jan 2025)
 * const result = calculateAllOccurrencesInPeriod(weeklyInflow, januaryPeriod);
 * // Result: { numberOfOccurrences: 4 or 5, occurrenceDueDates: [...], totalExpectedAmount: 2000 or 2500 }
 *
 * // Monthly salary ($5000) in monthly period when due
 * const result = calculateAllOccurrencesInPeriod(monthlySalary, januaryPeriod);
 * // Result: { numberOfOccurrences: 1, occurrenceDueDates: [Jan 15], totalExpectedAmount: 5000 }
 *
 * // Monthly salary in bi-monthly period when not due
 * const result = calculateAllOccurrencesInPeriod(monthlySalary, firstHalfPeriod);
 * // Result: { numberOfOccurrences: 0, occurrenceDueDates: [], totalExpectedAmount: 0 }
 * ```
 */
function calculateAllOccurrencesInPeriod(inflow, sourcePeriod) {
    var _a, _b;
    // Handle inactive income
    if (inflow.isActive === false) {
        return {
            numberOfOccurrences: 0,
            occurrenceDueDates: [],
            totalExpectedAmount: 0,
            nextExpectedDate: null,
            amountAllocated: 0,
            cycleDays: 0
        };
    }
    // Extract period boundaries
    const periodStart = (_a = sourcePeriod.startDate) === null || _a === void 0 ? void 0 : _a.toDate();
    const periodEnd = (_b = sourcePeriod.endDate) === null || _b === void 0 ? void 0 : _b.toDate();
    if (!periodStart || !periodEnd) {
        console.warn('[calculateAllOccurrencesInPeriod] Missing period dates');
        return {
            numberOfOccurrences: 0,
            occurrenceDueDates: [],
            totalExpectedAmount: 0,
            nextExpectedDate: null,
            amountAllocated: 0,
            cycleDays: 0
        };
    }
    // Get frequency from inflow
    const frequency = inflow.frequency;
    if (!frequency) {
        console.warn('[calculateAllOccurrencesInPeriod] Missing frequency');
        return {
            numberOfOccurrences: 0,
            occurrenceDueDates: [],
            totalExpectedAmount: 0,
            nextExpectedDate: null,
            amountAllocated: 0,
            cycleDays: 0
        };
    }
    // Calculate cycle days for this frequency
    const cycleDays = getCycleDays(frequency);
    // Get reference date from inflow (use predictedNextDate, lastDate, or firstDate)
    let referenceDate;
    if (inflow.predictedNextDate) {
        referenceDate = inflow.predictedNextDate.toDate();
    }
    else if (inflow.lastDate) {
        referenceDate = inflow.lastDate.toDate();
    }
    else if (inflow.firstDate) {
        referenceDate = inflow.firstDate.toDate();
    }
    else {
        console.warn('[calculateAllOccurrencesInPeriod] No reference date available');
        return {
            numberOfOccurrences: 0,
            occurrenceDueDates: [],
            totalExpectedAmount: 0,
            nextExpectedDate: null,
            amountAllocated: 0,
            cycleDays
        };
    }
    // Get amount per occurrence (always positive)
    const amountPerOccurrence = Math.abs(inflow.averageAmount || 0);
    // Find all occurrences that fall within the period
    // Due dates come from the shared domain calculation (same as live derive):
    // calendar-month cadences keep the anchor's day (setMonth stepping overflowed
    // the 29th–31st), semi-monthly uses two fixed days, and earlier occurrences in
    // the same period are no longer skipped.
    const window = (0, outflow_period_service_1.occurrence_dates_in_window)(referenceDate, frequency, periodStart, periodEnd);
    const occurrenceDueDates = window.dates.map((d) => firestore_1.Timestamp.fromDate(d));
    const nextExpectedDate = firestore_1.Timestamp.fromDate(window.next);
    const numberOfOccurrences = occurrenceDueDates.length;
    const totalExpectedAmount = numberOfOccurrences * amountPerOccurrence;
    // Calculate amountAllocated: distribute income across periods proportionally
    // Formula: amountPerOccurrence × (periodDays / cycleDays)
    // This gives a normalized "how much income belongs to this period" value
    const periodDays = getPeriodDays(periodStart, periodEnd);
    const amountAllocated = Math.round((amountPerOccurrence * (periodDays / cycleDays)) * 100) / 100;
    console.log(`[calculateAllOccurrencesInPeriod] Inflow: ${inflow.description || inflow.id}, ` +
        `Frequency: ${frequency}, Period: ${sourcePeriod.periodId || sourcePeriod.id}, ` +
        `Occurrences: ${numberOfOccurrences}, Total: $${totalExpectedAmount.toFixed(2)}, ` +
        `Allocated: $${amountAllocated.toFixed(2)}, NextExpected: ${nextExpectedDate.toDate().toISOString().split('T')[0]}`);
    return {
        numberOfOccurrences,
        occurrenceDueDates,
        totalExpectedAmount,
        nextExpectedDate,
        amountAllocated,
        cycleDays
    };
}
exports.default = calculateAllOccurrencesInPeriod;
//# sourceMappingURL=calculateAllOccurrencesInPeriod.js.map