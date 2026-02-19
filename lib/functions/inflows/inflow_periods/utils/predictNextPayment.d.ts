/**
 * Predict Next Payment Utility (Inflows)
 *
 * Calculates when the next income payment will be received and the expected amount.
 * Handles various income types including salary, commission, bonuses, and variable income.
 *
 * Prediction Priority:
 * 1. Plaid's predicted next date (if available and trusted)
 * 2. User override amount (for variable income)
 * 3. Rolling average (for variable income)
 * 4. Frequency-based calculation from last date
 */
import { Timestamp } from 'firebase-admin/firestore';
import { Inflow } from '../../../../types';
/**
 * Payment prediction result
 */
export interface PaymentPrediction {
    expectedDate: Timestamp;
    expectedAmount: number;
    confidenceLevel: 'high' | 'medium' | 'low';
    predictionMethod: 'plaid' | 'frequency' | 'rolling_average' | 'user_override';
    isInPeriod: boolean;
    daysUntilPayment: number;
}
/**
 * Predict the next payment date and amount for an income stream
 *
 * @param inflow - The recurring income definition
 * @param fromDate - The reference date to predict from (default: now)
 * @returns Payment prediction with date, amount, and confidence
 *
 * @example
 * ```typescript
 * // Regular biweekly salary
 * const prediction = predictNextPayment(salaryInflow);
 * // { expectedDate: Jan 17, expectedAmount: 2000, confidenceLevel: 'high', ... }
 *
 * // Variable commission income with user override
 * const prediction = predictNextPayment(commissionInflow);
 * // { expectedDate: Jan 31, expectedAmount: 3500, confidenceLevel: 'medium', predictionMethod: 'user_override' }
 * ```
 */
export declare function predictNextPayment(inflow: Partial<Inflow>, fromDate?: Date): PaymentPrediction | null;
/**
 * Predict all payments expected within a given period
 *
 * @param inflow - The recurring income definition
 * @param periodStart - Start of the viewing period
 * @param periodEnd - End of the viewing period
 * @returns Array of payment predictions for the period
 *
 * @example
 * ```typescript
 * // Weekly income in January
 * const predictions = predictPaymentsInPeriod(
 *   weeklyInflow,
 *   new Date('2025-01-01'),
 *   new Date('2025-01-31')
 * );
 * // Returns 4-5 predictions for each expected payment
 * ```
 */
export declare function predictPaymentsInPeriod(inflow: Partial<Inflow>, periodStart: Date, periodEnd: Date): PaymentPrediction[];
export default predictNextPayment;
//# sourceMappingURL=predictNextPayment.d.ts.map