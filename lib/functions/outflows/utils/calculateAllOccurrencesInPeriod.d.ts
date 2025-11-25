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
import { RecurringOutflow, SourcePeriod } from '../../../types';
/**
 * Result of calculating all occurrences in a period
 */
export interface PeriodOccurrences {
    numberOfOccurrences: number;
    occurrenceDueDates: Timestamp[];
    occurrenceDrawDates: Timestamp[];
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
export declare function calculateAllOccurrencesInPeriod(outflow: RecurringOutflow, sourcePeriod: SourcePeriod): PeriodOccurrences;
//# sourceMappingURL=calculateAllOccurrencesInPeriod.d.ts.map