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

import * as admin from 'firebase-admin';
import { RecurringOutflow, SourcePeriod, PlaidRecurringFrequency } from '../../../types';

/**
 * Result of predicting future bill due date
 */
export interface PredictedBillDates {
  expectedDueDate: admin.firestore.Timestamp;
  expectedDrawDate: admin.firestore.Timestamp;
}

/**
 * Add frequency interval to a date
 *
 * @param date - Starting date
 * @param frequency - Recurring frequency
 * @returns New date with interval added
 */
function addFrequencyInterval(date: Date, frequency: PlaidRecurringFrequency): Date {
  const newDate = new Date(date);

  switch (frequency) {
    case PlaidRecurringFrequency.WEEKLY:
      newDate.setDate(newDate.getDate() + 7);
      break;

    case PlaidRecurringFrequency.BIWEEKLY:
      newDate.setDate(newDate.getDate() + 14);
      break;

    case PlaidRecurringFrequency.SEMI_MONTHLY:
      newDate.setDate(newDate.getDate() + 15);
      break;

    case PlaidRecurringFrequency.MONTHLY:
      newDate.setMonth(newDate.getMonth() + 1);
      break;

    case PlaidRecurringFrequency.ANNUALLY:
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
function adjustForWeekend(date: Date): Date {
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const adjustedDate = new Date(date);

  if (dayOfWeek === 0) {
    // Sunday → add 1 day to get Monday
    adjustedDate.setDate(adjustedDate.getDate() + 1);
  } else if (dayOfWeek === 6) {
    // Saturday → add 2 days to get Monday
    adjustedDate.setDate(adjustedDate.getDate() + 2);
  }

  return adjustedDate;
}

/**
 * Predict the next expected due date and draw date for a bill in a given period
 *
 * This function projects forward from the outflow's lastDate to find the next
 * occurrence that is on or after the period's start date. This ensures:
 * - Periods where bill IS due show the current period's due date
 * - Periods where bill is NOT due show the next future due date
 *
 * @param outflow - The recurring outflow
 * @param sourcePeriod - The period to predict for
 * @returns Expected due date and draw date (adjusted for weekends)
 *
 * @example
 * ```typescript
 * // Netflix: $15.99/month, lastDate = Dec 15
 * // For period Jan 1-7:
 * const dates = predictFutureBillDueDate(outflow, sourcePeriod);
 * // Result: { expectedDueDate: Jan 15, expectedDrawDate: Jan 15 }
 *
 * // For period Jan 22-28:
 * const dates = predictFutureBillDueDate(outflow, sourcePeriod);
 * // Result: { expectedDueDate: Feb 15, expectedDrawDate: Feb 15 }
 * ```
 */
export function predictFutureBillDueDate(
  outflow: RecurringOutflow,
  sourcePeriod: SourcePeriod
): PredictedBillDates {
  // Start with the outflow's last known occurrence
  let nextDueDate = outflow.lastDate.toDate();
  const periodStart = sourcePeriod.startDate.toDate();

  // Project forward by adding frequency intervals until we reach/exceed period start
  // This finds the NEXT occurrence relative to this period
  while (nextDueDate < periodStart) {
    nextDueDate = addFrequencyInterval(nextDueDate, outflow.frequency);
  }

  // Adjust for weekend - if due date is Saturday/Sunday, expect draw on Monday
  const expectedDrawDate = adjustForWeekend(nextDueDate);

  console.log(
    `[predictFutureBillDueDate] ${outflow.description} - Period: ${sourcePeriod.id}, ` +
    `Expected Due: ${nextDueDate.toISOString().split('T')[0]}, ` +
    `Expected Draw: ${expectedDrawDate.toISOString().split('T')[0]}`
  );

  return {
    expectedDueDate: admin.firestore.Timestamp.fromDate(nextDueDate),
    expectedDrawDate: admin.firestore.Timestamp.fromDate(expectedDrawDate)
  };
}
