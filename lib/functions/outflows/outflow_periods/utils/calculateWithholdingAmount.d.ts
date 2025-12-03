/**
 * Outflow Withholding Amount Calculation Utility
 *
 * Provides day-based calculation for determining how much to withhold each period
 * for recurring bills/outflows. Uses actual month days for accurate calculations,
 * matching the budget allocation system.
 *
 * This is the single source of truth for withholding amount calculations.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { RecurringOutflow, SourcePeriod, PlaidRecurringFrequency } from '../../../../types';
/**
 * Payment cycle information
 */
export interface PaymentCycleInfo {
    billAmount: number;
    cycleDays: number;
    frequency: PlaidRecurringFrequency;
    cycleStartDate: Timestamp;
    cycleEndDate: Timestamp;
}
/**
 * Withholding calculation result
 */
export interface WithholdingCalculation {
    amountWithheld: number;
    amountDue: number;
    isDuePeriod: boolean;
    dueDate?: Timestamp;
}
/**
 * Calculate the payment cycle information from outflow frequency
 *
 * This determines how often the bill occurs and provides cycle metadata.
 *
 * @param outflow - The recurring outflow to calculate cycle for
 * @returns Payment cycle information
 *
 * @example
 * ```typescript
 * // Monthly bill of $90
 * const cycleInfo = calculatePaymentCycle(outflow);
 * // Result: { cycleDays: 30, frequency: 'MONTHLY', ... }
 * ```
 */
export declare function calculatePaymentCycle(outflow: RecurringOutflow): PaymentCycleInfo;
/**
 * Calculate withholding amount for a specific period based on actual days
 *
 * Uses day-based calculations similar to budget allocation:
 * - MONTHLY bills → day-by-day iteration using actual month days
 * - WEEKLY bills → (target period days / 7) × weekly amount
 * - BIWEEKLY bills → (target period days / 14) × biweekly amount
 * - SEMI_MONTHLY bills → (target period days / 15) × semi-monthly amount
 * - ANNUALLY bills → (target period days / 365) × annual amount
 *
 * This ensures withholding aligns correctly with varying month lengths
 * and properly handles periods that span multiple months.
 *
 * @param sourcePeriod - The target source period to calculate withholding for
 * @param cycleInfo - Payment cycle information from calculatePaymentCycle
 * @param outflow - The recurring outflow (for logging)
 * @returns Withholding calculation result
 *
 * @example
 * ```typescript
 * // Monthly bill: $90/month
 * // February (28 days): $90/28 = $3.214/day
 * // March (31 days): $90/31 = $2.903/day
 * // Week spanning Feb-Mar (3 days Feb + 4 days Mar):
 * //   - 3 days × $3.214 = $9.64
 * //   - 4 days × $2.903 = $11.61
 * //   - Total: $21.25 ✓ (accurate for month-spanning week)
 *
 * // Weekly bill: $25/week → $3.57/day
 * // Monthly period (30 days): (30/7) × $25 = $107.14
 * ```
 */
export declare function calculateWithholdingAmount(sourcePeriod: SourcePeriod, cycleInfo: PaymentCycleInfo, outflow: RecurringOutflow): WithholdingCalculation;
/**
 * Get the daily withholding rate for an outflow
 *
 * Note: For monthly bills, this returns an average. Use calculateWithholdingAmount
 * for accurate day-by-day calculations that account for varying month lengths.
 *
 * @param outflow - The recurring outflow
 * @returns Average daily withholding rate
 */
export declare function getDailyWithholdingRate(outflow: RecurringOutflow): number;
/**
 * Calculate total withholding needed across multiple periods
 *
 * Useful for showing users how much they need to save in total
 * across a date range (e.g., "Save $60 this month for bills")
 *
 * @param sourcePeriods - Array of source periods to calculate across
 * @param cycleInfo - Payment cycle information
 * @param outflow - The recurring outflow
 * @returns Total withholding amount across all periods
 */
export declare function calculateTotalWithholding(sourcePeriods: SourcePeriod[], cycleInfo: PaymentCycleInfo, outflow: RecurringOutflow): number;
//# sourceMappingURL=calculateWithholdingAmount.d.ts.map