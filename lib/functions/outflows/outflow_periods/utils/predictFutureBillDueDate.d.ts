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
import { Timestamp } from 'firebase-admin/firestore';
import { RecurringOutflow, SourcePeriod } from '../../../../types';
/**
 * Result of predicting future bill due date
 */
export interface PredictedBillDates {
    expectedDueDate: Timestamp;
    expectedDrawDate: Timestamp;
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
export declare function predictFutureBillDueDate(outflow: RecurringOutflow, sourcePeriod: SourcePeriod): PredictedBillDates;
//# sourceMappingURL=predictFutureBillDueDate.d.ts.map