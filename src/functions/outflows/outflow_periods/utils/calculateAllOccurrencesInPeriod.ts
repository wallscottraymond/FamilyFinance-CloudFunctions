/**
 * Calculate All Occurrences in Period Utility
 *
 * Calculates ALL occurrences of a recurring bill that fall within a specific period.
 * This handles variable occurrence counts (e.g., 4 vs 5 Mondays in a month).
 *
 * Key Features:
 * - Iterates through period to find ALL due dates, not just the next one
 * - Handles variable month lengths automatically
 * - Works with all Plaid recurring frequencies (WEEKLY, BIWEEKLY, etc.)
 * - Returns parallel arrays for due dates, paid flags, and transaction IDs
 *
 * Example: Weekly bill occurring in a monthly period
 * - January 2025 (Wed starts): 4 Wednesdays (1, 8, 15, 22, 29)
 * - February 2025: 4 Wednesdays (5, 12, 19, 26)
 * - March 2025: 5 Wednesdays (5, 12, 19, 26, and partial week to April 2)
 */

import { Timestamp } from 'firebase-admin/firestore';
import { RecurringOutflow, SourcePeriod, PlaidRecurringFrequency, OutflowOccurrence } from '../../../../types';

/**
 * Result of calculating all occurrences in a period
 *
 * UPDATED: Now returns occurrence objects in addition to parallel arrays
 * for backward compatibility during migration
 */
export interface PeriodOccurrences {
  numberOfOccurrences: number;

  // NEW: Occurrence object array (preferred)
  occurrences: OutflowOccurrence[];

  // LEGACY: Parallel arrays (kept for backward compatibility)
  /** @deprecated Use occurrences array instead */
  occurrenceDueDates: Timestamp[];
  /** @deprecated Use occurrences array instead */
  occurrenceDrawDates: Timestamp[];
}

/**
 * Add frequency interval to a date (reused from predictFutureBillDueDate)
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
 * Subtract frequency interval from a date (for rewinding)
 *
 * @param date - Starting date
 * @param frequency - Recurring frequency
 * @returns New date with interval subtracted
 */
function subtractFrequencyInterval(date: Date, frequency: PlaidRecurringFrequency): Date {
  const newDate = new Date(date);

  switch (frequency) {
    case PlaidRecurringFrequency.WEEKLY:
      newDate.setDate(newDate.getDate() - 7);
      break;

    case PlaidRecurringFrequency.BIWEEKLY:
      newDate.setDate(newDate.getDate() - 14);
      break;

    case PlaidRecurringFrequency.SEMI_MONTHLY:
      newDate.setDate(newDate.getDate() - 15);
      break;

    case PlaidRecurringFrequency.MONTHLY:
      newDate.setMonth(newDate.getMonth() - 1);
      break;

    case PlaidRecurringFrequency.ANNUALLY:
      newDate.setFullYear(newDate.getFullYear() - 1);
      break;

    default:
      console.warn(`[subtractFrequencyInterval] Unknown frequency: ${frequency}, defaulting to monthly`);
      newDate.setMonth(newDate.getMonth() - 1);
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
 * Calculate all occurrences of a recurring bill within a specific period
 *
 * This function:
 * 1. Starts from Plaid's predictedNextDate (or lastDate as fallback)
 * 2. Rewinds to find the first occurrence at or before period start
 * 3. Iterates forward by frequency interval
 * 4. Collects ALL dates that fall within [periodStart, periodEnd]
 * 5. Returns actual occurrence count (handles 4 vs 5 Mondays automatically)
 *
 * @param outflow - The recurring outflow
 * @param sourcePeriod - The period to calculate occurrences for
 * @returns Object with occurrence count and arrays of due dates and draw dates
 *
 * @example
 * ```typescript
 * // Weekly bill on Mondays, Monthly period Feb 2025 (4 Mondays)
 * const result = calculateAllOccurrencesInPeriod(outflow, februaryPeriod);
 * // Result: {
 * //   numberOfOccurrences: 4,
 * //   occurrenceDueDates: [Feb 3, Feb 10, Feb 17, Feb 24],
 * //   occurrenceDrawDates: [Feb 3, Feb 10, Feb 17, Feb 24] (all weekdays)
 * // }
 *
 * // Same weekly bill, March 2025 (5 Mondays)
 * const result = calculateAllOccurrencesInPeriod(outflow, marchPeriod);
 * // Result: {
 * //   numberOfOccurrences: 5,
 * //   occurrenceDueDates: [Mar 3, Mar 10, Mar 17, Mar 24, Mar 31],
 * //   occurrenceDrawDates: [Mar 3, Mar 10, Mar 17, Mar 24, Mar 31]
 * // }
 * ```
 */
export function calculateAllOccurrencesInPeriod(
  outflow: RecurringOutflow,
  sourcePeriod: SourcePeriod
): PeriodOccurrences {
  const periodStart = sourcePeriod.startDate.toDate();
  const periodEnd = sourcePeriod.endDate.toDate();

  console.log(
    `[calculateAllOccurrencesInPeriod] Calculating for ${outflow.description || 'Unnamed'} ` +
    `(${outflow.frequency}) in period ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`
  );

  // Step 1: Start with Plaid's predicted date or last known occurrence
  let referenceDate: Date;
  if (outflow.predictedNextDate) {
    referenceDate = outflow.predictedNextDate.toDate();
    console.log(`[calculateAllOccurrencesInPeriod] Using Plaid predictedNextDate: ${referenceDate.toISOString().split('T')[0]}`);
  } else {
    referenceDate = outflow.lastDate.toDate();
    console.log(`[calculateAllOccurrencesInPeriod] No predictedNextDate, using lastDate: ${referenceDate.toISOString().split('T')[0]}`);
  }

  // Step 2: Rewind to find the first occurrence at or before period start
  // This ensures we don't miss any occurrences that start before the period begins
  let firstOccurrence = new Date(referenceDate);
  while (firstOccurrence > periodStart) {
    firstOccurrence = subtractFrequencyInterval(firstOccurrence, outflow.frequency);
  }

  // If we rewound too far (before period start), advance one interval to get first occurrence IN period
  if (firstOccurrence < periodStart) {
    firstOccurrence = addFrequencyInterval(firstOccurrence, outflow.frequency);
  }

  console.log(`[calculateAllOccurrencesInPeriod] First occurrence in period: ${firstOccurrence.toISOString().split('T')[0]}`);

  // Step 3: Iterate forward from first occurrence, collecting all dates within period
  const dueDates: Timestamp[] = [];
  const drawDates: Timestamp[] = [];
  const occurrences: OutflowOccurrence[] = [];
  let currentOccurrence = new Date(firstOccurrence);
  let occurrenceIndex = 0;

  while (currentOccurrence <= periodEnd) {
    // Create timestamps for this occurrence
    const dueDate = Timestamp.fromDate(currentOccurrence);
    const drawDate = Timestamp.fromDate(adjustForWeekend(currentOccurrence));

    // Add to parallel arrays (legacy)
    dueDates.push(dueDate);
    drawDates.push(drawDate);

    // Create occurrence object (new pattern)
    const occurrence: OutflowOccurrence = {
      id: `${sourcePeriod.id}_occ_${occurrenceIndex}`,
      dueDate: dueDate,
      isPaid: false,
      transactionId: null,
      transactionSplitId: null,
      paymentDate: null,
      amountDue: outflow.averageAmount,
      amountPaid: 0,
      paymentType: null,
      isAutoMatched: false,
      matchedAt: null,
      matchedBy: null,
    };
    occurrences.push(occurrence);

    console.log(
      `[calculateAllOccurrencesInPeriod] Occurrence #${occurrenceIndex + 1}: ` +
      `ID=${occurrence.id}, ` +
      `Due ${currentOccurrence.toISOString().split('T')[0]}, ` +
      `Draw ${adjustForWeekend(currentOccurrence).toISOString().split('T')[0]}`
    );

    // Move to next occurrence
    currentOccurrence = addFrequencyInterval(currentOccurrence, outflow.frequency);
    occurrenceIndex++;
  }

  const result = {
    numberOfOccurrences: dueDates.length,
    occurrences: occurrences,
    occurrenceDueDates: dueDates,
    occurrenceDrawDates: drawDates
  };

  console.log(
    `[calculateAllOccurrencesInPeriod] Result: ${result.numberOfOccurrences} occurrence(s) found for ` +
    `${outflow.description || 'Unnamed'} in period ${sourcePeriod.id}`
  );

  return result;
}
