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
/**
 * Add frequency interval to a date
 *
 * @param date - Starting date
 * @param frequency - Recurring frequency
 * @returns New date with interval added
 */
function addFrequencyInterval(date, frequency) {
    const newDate = new Date(date);
    switch (frequency) {
        case types_1.PlaidRecurringFrequency.WEEKLY:
        case 'WEEKLY':
            newDate.setDate(newDate.getDate() + 7);
            break;
        case types_1.PlaidRecurringFrequency.BIWEEKLY:
        case 'BIWEEKLY':
            newDate.setDate(newDate.getDate() + 14);
            break;
        case types_1.PlaidRecurringFrequency.SEMI_MONTHLY:
        case 'SEMI_MONTHLY':
            // Semi-monthly: approximately 15 days (1st and 15th, or 15th and end of month)
            newDate.setDate(newDate.getDate() + 15);
            break;
        case types_1.PlaidRecurringFrequency.MONTHLY:
        case 'MONTHLY':
            newDate.setMonth(newDate.getMonth() + 1);
            break;
        case 'QUARTERLY':
            // QUARTERLY is not in PlaidRecurringFrequency but supported for manual inflows
            newDate.setMonth(newDate.getMonth() + 3);
            break;
        case types_1.PlaidRecurringFrequency.ANNUALLY:
        case 'ANNUALLY':
            newDate.setFullYear(newDate.getFullYear() + 1);
            break;
        default:
            console.warn(`[addFrequencyInterval] Unknown frequency: ${frequency}, defaulting to monthly`);
            newDate.setMonth(newDate.getMonth() + 1);
    }
    return newDate;
}
/**
 * Subtract frequency interval from a date (for backward iteration)
 *
 * @param date - Starting date
 * @param frequency - Recurring frequency
 * @returns New date with interval subtracted
 */
function subtractFrequencyInterval(date, frequency) {
    const newDate = new Date(date);
    switch (frequency) {
        case types_1.PlaidRecurringFrequency.WEEKLY:
        case 'WEEKLY':
            newDate.setDate(newDate.getDate() - 7);
            break;
        case types_1.PlaidRecurringFrequency.BIWEEKLY:
        case 'BIWEEKLY':
            newDate.setDate(newDate.getDate() - 14);
            break;
        case types_1.PlaidRecurringFrequency.SEMI_MONTHLY:
        case 'SEMI_MONTHLY':
            newDate.setDate(newDate.getDate() - 15);
            break;
        case types_1.PlaidRecurringFrequency.MONTHLY:
        case 'MONTHLY':
            newDate.setMonth(newDate.getMonth() - 1);
            break;
        case 'QUARTERLY':
            newDate.setMonth(newDate.getMonth() - 3);
            break;
        case types_1.PlaidRecurringFrequency.ANNUALLY:
        case 'ANNUALLY':
            newDate.setFullYear(newDate.getFullYear() - 1);
            break;
        default:
            newDate.setMonth(newDate.getMonth() - 1);
    }
    return newDate;
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
            totalExpectedAmount: 0
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
            totalExpectedAmount: 0
        };
    }
    // Get frequency from inflow
    const frequency = inflow.frequency;
    if (!frequency) {
        console.warn('[calculateAllOccurrencesInPeriod] Missing frequency');
        return {
            numberOfOccurrences: 0,
            occurrenceDueDates: [],
            totalExpectedAmount: 0
        };
    }
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
            totalExpectedAmount: 0
        };
    }
    // Get amount per occurrence (always positive)
    const amountPerOccurrence = Math.abs(inflow.averageAmount || 0);
    // Find all occurrences that fall within the period
    const occurrenceDueDates = [];
    // Start from a point before the period and iterate forward
    // This ensures we don't miss any occurrences
    let currentDate = new Date(referenceDate);
    // If reference date is after period end, work backwards to find first occurrence in/before period
    while (currentDate > periodEnd) {
        currentDate = subtractFrequencyInterval(currentDate, frequency);
    }
    // If reference date is before period start, work forwards to find first occurrence in period
    while (currentDate < periodStart) {
        currentDate = addFrequencyInterval(currentDate, frequency);
    }
    // Now iterate through the period and collect all occurrences
    while (currentDate <= periodEnd) {
        if (currentDate >= periodStart) {
            // Handle month-end adjustment for monthly frequencies
            // If original due day is 31 and current month has fewer days, adjust
            const adjustedDate = adjustForMonthEnd(currentDate, referenceDate, frequency);
            occurrenceDueDates.push(firestore_1.Timestamp.fromDate(adjustedDate));
        }
        currentDate = addFrequencyInterval(currentDate, frequency);
    }
    const numberOfOccurrences = occurrenceDueDates.length;
    const totalExpectedAmount = numberOfOccurrences * amountPerOccurrence;
    console.log(`[calculateAllOccurrencesInPeriod] Inflow: ${inflow.description || inflow.id}, ` +
        `Frequency: ${frequency}, Period: ${sourcePeriod.periodId || sourcePeriod.id}, ` +
        `Occurrences: ${numberOfOccurrences}, Total: $${totalExpectedAmount.toFixed(2)}`);
    return {
        numberOfOccurrences,
        occurrenceDueDates,
        totalExpectedAmount
    };
}
/**
 * Adjust date for month-end edge cases
 *
 * For monthly+ frequencies, if the original due day is after the current month's end,
 * adjust to the last day of the current month.
 *
 * Example: If paid on 31st, February adjusts to 28th (or 29th in leap year)
 */
function adjustForMonthEnd(currentDate, referenceDate, frequency) {
    // Only apply adjustment for monthly or longer frequencies
    if (frequency !== types_1.PlaidRecurringFrequency.MONTHLY &&
        frequency !== 'MONTHLY' &&
        frequency !== 'QUARTERLY' &&
        frequency !== types_1.PlaidRecurringFrequency.ANNUALLY &&
        frequency !== 'ANNUALLY') {
        return currentDate;
    }
    const originalDay = referenceDate.getDate();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    // Get last day of current month
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    // If original day is greater than current month's last day, use last day
    if (originalDay > lastDayOfMonth) {
        return new Date(currentYear, currentMonth, lastDayOfMonth);
    }
    return currentDate;
}
exports.default = calculateAllOccurrencesInPeriod;
//# sourceMappingURL=calculateAllOccurrencesInPeriod.js.map