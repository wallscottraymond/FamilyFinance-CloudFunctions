/**
 * Check if Due Period Utility
 *
 * Determines if a bill's expected due date falls within a specific period's boundaries.
 * This is a focused utility for period-based due date checking, separate from
 * withholding calculations.
 *
 * This utility is called during outflow period creation to set the isDuePeriod flag.
 */

import * as admin from 'firebase-admin';

/**
 * Check if the expected due date falls within the period boundaries
 *
 * This utility determines if a bill is due during a specific period by checking
 * if the expected due date falls between the period start and end dates (inclusive).
 *
 * @param expectedDueDate - The predicted due date for the bill
 * @param periodStartDate - Period start timestamp
 * @param periodEndDate - Period end timestamp
 * @returns True if the expected due date falls within the period, false otherwise
 *
 * @example
 * ```typescript
 * // Netflix due Jan 15
 * // Period: Jan 1-31
 * const isDue = checkIsDuePeriod(jan15Timestamp, jan1Timestamp, jan31Timestamp);
 * // Result: true
 *
 * // Netflix due Feb 15
 * // Period: Jan 1-31
 * const isDue = checkIsDuePeriod(feb15Timestamp, jan1Timestamp, jan31Timestamp);
 * // Result: false
 * ```
 */
export function checkIsDuePeriod(
  expectedDueDate: admin.firestore.Timestamp,
  periodStartDate: admin.firestore.Timestamp,
  periodEndDate: admin.firestore.Timestamp
): boolean {
  const dueDate = expectedDueDate.toDate();
  const periodStart = periodStartDate.toDate();
  const periodEnd = periodEndDate.toDate();

  // Check if due date is within period boundaries (inclusive)
  const isDue = dueDate >= periodStart && dueDate <= periodEnd;

  return isDue;
}
