"use strict";
/**
 * Predict Future Bill Due Date Utility
 *
 * Calculates the next expected due date and draw date for recurring bills
 * relative to a specific period. This ensures each period shows when the
 * next bill occurrence will happen, even if it's not due in that period.
 *
 * Example: Monthly bill due on 15th
 * - Week of Jan 1-7: Shows Jan 15
 * - Week of Jan 22-28: Shows Feb 15
 * - Week of Feb 1-7: Shows Feb 15
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.predictFutureBillDueDate = predictFutureBillDueDate;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../types");
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
            newDate.setDate(newDate.getDate() + 7);
            break;
        case types_1.PlaidRecurringFrequency.BIWEEKLY:
            newDate.setDate(newDate.getDate() + 14);
            break;
        case types_1.PlaidRecurringFrequency.SEMI_MONTHLY:
            newDate.setDate(newDate.getDate() + 15);
            break;
        case types_1.PlaidRecurringFrequency.MONTHLY:
            newDate.setMonth(newDate.getMonth() + 1);
            break;
        case types_1.PlaidRecurringFrequency.ANNUALLY:
            newDate.setFullYear(newDate.getFullYear() + 1);
            break;
        default:
            console.warn(`[addFrequencyInterval] Unknown frequency: ${frequency}, defaulting to monthly`);
            newDate.setMonth(newDate.getMonth() + 1);
    }
    return newDate;
}
/**
 * Adjust date for weekend (Saturday/Sunday) by moving to following Monday
 *
 * @param date - Date to check
 * @returns Date adjusted to Monday if weekend, otherwise same date
 */
function adjustForWeekend(date) {
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
    const adjustedDate = new Date(date);
    if (dayOfWeek === 0) {
        // Sunday → add 1 day to get Monday
        adjustedDate.setDate(adjustedDate.getDate() + 1);
    }
    else if (dayOfWeek === 6) {
        // Saturday → add 2 days to get Monday
        adjustedDate.setDate(adjustedDate.getDate() + 2);
    }
    return adjustedDate;
}
/**
 * Predict the next expected due date and draw date for a bill in a given period
 *
 * This function uses Plaid's predictedNextDate if available, otherwise projects
 * forward from the outflow's lastDate to find the next occurrence that is on or
 * after the period's start date. This ensures:
 * - Periods where bill IS due show the current period's due date
 * - Periods where bill is NOT due show the next future due date
 *
 * @param outflow - The recurring outflow
 * @param sourcePeriod - The period to predict for
 * @returns Expected due date and draw date (adjusted for weekends)
 *
 * @example
 * ```typescript
 * // Netflix: $15.99/month, predictedNextDate = Jan 15 (or lastDate = Dec 15)
 * // For period Jan 1-7:
 * const dates = predictFutureBillDueDate(outflow, sourcePeriod);
 * // Result: { expectedDueDate: Jan 15, expectedDrawDate: Jan 15 }
 *
 * // For period Jan 22-28:
 * const dates = predictFutureBillDueDate(outflow, sourcePeriod);
 * // Result: { expectedDueDate: Feb 15, expectedDrawDate: Feb 15 }
 * ```
 */
function predictFutureBillDueDate(outflow, sourcePeriod) {
    // Start with Plaid's predicted date if available, otherwise use last known occurrence
    let nextDueDate;
    if (outflow.predictedNextDate) {
        nextDueDate = outflow.predictedNextDate.toDate();
        console.log(`[predictFutureBillDueDate] Using Plaid predictedNextDate: ${nextDueDate.toISOString().split('T')[0]}`);
    }
    else {
        nextDueDate = outflow.lastDate.toDate();
        console.log(`[predictFutureBillDueDate] No predictedNextDate, using lastDate: ${nextDueDate.toISOString().split('T')[0]}`);
    }
    const periodStart = sourcePeriod.startDate.toDate();
    // Project forward by adding frequency intervals until we reach/exceed period start
    // This finds the NEXT occurrence relative to this period
    while (nextDueDate < periodStart) {
        nextDueDate = addFrequencyInterval(nextDueDate, outflow.frequency);
    }
    // Adjust for weekend - if due date is Saturday/Sunday, expect draw on Monday
    const expectedDrawDate = adjustForWeekend(nextDueDate);
    console.log(`[predictFutureBillDueDate] ${outflow.description} - Period: ${sourcePeriod.id}, ` +
        `Expected Due: ${nextDueDate.toISOString().split('T')[0]}, ` +
        `Expected Draw: ${expectedDrawDate.toISOString().split('T')[0]}`);
    return {
        expectedDueDate: firestore_1.Timestamp.fromDate(nextDueDate),
        expectedDrawDate: firestore_1.Timestamp.fromDate(expectedDrawDate)
    };
}
//# sourceMappingURL=predictFutureBillDueDate.js.map