/**
 * Outflow Withholding Amount Calculation Utility
 *
 * Provides day-based calculation for determining how much to withhold each period
 * for recurring bills/outflows. Uses actual month days for accurate calculations,
 * matching the budget allocation system.
 *
 * This is the single source of truth for withholding amount calculations.
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { RecurringOutflow, SourcePeriod, PlaidRecurringFrequency } from '../../../types';

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
  amountWithheld: number;      // Amount to set aside in this period
  amountDue: number;            // Amount due if bill is due in this period
  isDuePeriod: boolean;         // Whether bill is due in this period
  dueDate?: admin.firestore.Timestamp; // Actual due date if applicable
}

/**
 * Calculate the number of days in a period (inclusive of both start and end)
 */
function getDaysInPeriod(startDate: admin.firestore.Timestamp, endDate: admin.firestore.Timestamp): number {
  const start = startDate.toDate();
  const end = endDate.toDate();
  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end day
  return diffDays;
}

/**
 * Get the number of days in a specific month
 */
function getDaysInMonth(year: number, month: number): number {
  // Month is 0-indexed (0 = January, 11 = December)
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Calculate withholding for a monthly bill across any target period
 * Handles periods that span multiple months by calculating day-by-day
 * using each month's actual number of days
 */
function calculateMonthlyWithholding(
  monthlyAmount: number,
  targetPeriod: SourcePeriod
): number {
  const startDate = targetPeriod.startDate.toDate();
  const endDate = targetPeriod.endDate.toDate();

  let totalWithholding = 0;
  const currentDate = new Date(startDate);

  // Iterate through each day in the target period
  while (currentDate <= endDate) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); // 0-indexed
    const daysInCurrentMonth = getDaysInMonth(year, month);
    const dailyRateForMonth = monthlyAmount / daysInCurrentMonth;

    totalWithholding += dailyRateForMonth;

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return totalWithholding;
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
export function calculatePaymentCycle(outflow: RecurringOutflow): PaymentCycleInfo {
  // Flat structure: averageAmount is a direct number
  const billAmount = Math.abs(outflow.averageAmount); // Ensure positive

  // Calculate cycle days based on frequency
  let cycleDays: number;
  switch (outflow.frequency) {
    case PlaidRecurringFrequency.WEEKLY:
      cycleDays = 7;
      break;
    case PlaidRecurringFrequency.BIWEEKLY:
      cycleDays = 14;
      break;
    case PlaidRecurringFrequency.SEMI_MONTHLY:
      cycleDays = 15; // Approximate - twice per month
      break;
    case PlaidRecurringFrequency.MONTHLY:
      cycleDays = 30; // Use 30 as average for cycle tracking
      break;
    case PlaidRecurringFrequency.ANNUALLY:
      cycleDays = 365;
      break;
    default:
      console.warn(`[calculatePaymentCycle] Unknown frequency: ${outflow.frequency}, defaulting to 30 days`);
      cycleDays = 30;
  }

  // Use the outflow's lastDate as cycle end, calculate cycle start
  const cycleEndDate = outflow.lastDate;
  const cycleStartDate = Timestamp.fromDate(
    new Date(cycleEndDate.toDate().getTime() - (cycleDays * 24 * 60 * 60 * 1000))
  );

  console.log(
    `[calculatePaymentCycle] ${outflow.description}: ` +
    `$${billAmount} ${outflow.frequency} (${cycleDays}-day cycle)`
  );

  return {
    billAmount,
    cycleDays,
    frequency: outflow.frequency,
    cycleStartDate,
    cycleEndDate
  };
}

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
export function calculateWithholdingAmount(
  sourcePeriod: SourcePeriod,
  cycleInfo: PaymentCycleInfo,
  outflow: RecurringOutflow
): WithholdingCalculation {
  const periodStart = sourcePeriod.startDate.toDate();
  const periodEnd = sourcePeriod.endDate.toDate();
  const cycleEnd = cycleInfo.cycleEndDate.toDate();

  let amountWithheld: number;

  // Calculate withholding based on frequency type
  switch (cycleInfo.frequency) {
    case PlaidRecurringFrequency.MONTHLY:
      // For monthly bills, use day-by-day calculation with actual month days
      // This handles month-spanning periods correctly (e.g., weeks across Feb-Mar)
      amountWithheld = calculateMonthlyWithholding(cycleInfo.billAmount, sourcePeriod);

      console.log(
        `[calculateWithholdingAmount] ${outflow.description} - Period: ${sourcePeriod.id}, ` +
        `Monthly day-by-day: $${amountWithheld.toFixed(2)}`
      );
      break;

    case PlaidRecurringFrequency.WEEKLY:
    case PlaidRecurringFrequency.BIWEEKLY:
    case PlaidRecurringFrequency.SEMI_MONTHLY:
    case PlaidRecurringFrequency.ANNUALLY:
      // For other frequencies, use simple daily rate calculation
      const targetDays = getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate);
      const dailyRate = cycleInfo.billAmount / cycleInfo.cycleDays;
      amountWithheld = dailyRate * targetDays;

      console.log(
        `[calculateWithholdingAmount] ${outflow.description} - Period: ${sourcePeriod.id}, ` +
        `${cycleInfo.frequency}: ${targetDays} days × $${dailyRate.toFixed(2)}/day = $${amountWithheld.toFixed(2)}`
      );
      break;

    default:
      // Fallback: use cycle days as divisor
      const fallbackDays = getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate);
      const fallbackRate = cycleInfo.billAmount / cycleInfo.cycleDays;
      amountWithheld = fallbackRate * fallbackDays;

      console.warn(
        `[calculateWithholdingAmount] Unknown frequency ${cycleInfo.frequency}, using fallback calculation`
      );
  }

  // Check if due date falls within this period
  const isDuePeriod = cycleEnd >= periodStart && cycleEnd <= periodEnd;
  const amountDue = isDuePeriod ? cycleInfo.billAmount : 0;
  const dueDate = isDuePeriod ? admin.firestore.Timestamp.fromDate(cycleEnd) : undefined;

  if (isDuePeriod) {
    console.log(
      `[calculateWithholdingAmount] ${outflow.description} - DUE in ${sourcePeriod.id}: ` +
      `$${amountDue.toFixed(2)} on ${cycleEnd.toISOString().split('T')[0]}`
    );
  }

  return {
    amountWithheld: Math.round(amountWithheld * 100) / 100, // Round to 2 decimal places
    amountDue: Math.round(amountDue * 100) / 100,
    isDuePeriod,
    dueDate
  };
}

/**
 * Get the daily withholding rate for an outflow
 *
 * Note: For monthly bills, this returns an average. Use calculateWithholdingAmount
 * for accurate day-by-day calculations that account for varying month lengths.
 *
 * @param outflow - The recurring outflow
 * @returns Average daily withholding rate
 */
export function getDailyWithholdingRate(outflow: RecurringOutflow): number {
  const cycleInfo = calculatePaymentCycle(outflow);
  return cycleInfo.billAmount / cycleInfo.cycleDays;
}

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
export function calculateTotalWithholding(
  sourcePeriods: SourcePeriod[],
  cycleInfo: PaymentCycleInfo,
  outflow: RecurringOutflow
): number {
  let total = 0;

  for (const period of sourcePeriods) {
    const calc = calculateWithholdingAmount(period, cycleInfo, outflow);
    total += calc.amountWithheld;
  }

  return Math.round(total * 100) / 100;
}
