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
import { Timestamp } from 'firebase-admin/firestore';
import { Inflow, SourcePeriod } from '../../../../types';
/**
 * Result of calculating occurrences for a period
 */
export interface OccurrenceResult {
    numberOfOccurrences: number;
    occurrenceDueDates: Timestamp[];
    totalExpectedAmount: number;
    /** The next expected payment date (for periods with or without occurrences) */
    nextExpectedDate: Timestamp | null;
    /** Amount allocated to this period for budgeting (distributes income across periods) */
    amountAllocated: number;
    /** Number of days between income payments (based on frequency) */
    cycleDays: number;
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
export declare function calculateAllOccurrencesInPeriod(inflow: Partial<Inflow>, sourcePeriod: Partial<SourcePeriod>): OccurrenceResult;
export default calculateAllOccurrencesInPeriod;
//# sourceMappingURL=calculateAllOccurrencesInPeriod.d.ts.map