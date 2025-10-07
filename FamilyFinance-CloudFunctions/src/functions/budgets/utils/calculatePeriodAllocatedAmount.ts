/**
 * Budget Period Amount Allocation Utility
 *
 * Provides day-based calculation for converting budget amounts between different
 * period types (weekly, bi-monthly, monthly) based on actual days in each period.
 *
 * This is the single source of truth for budget amount allocation across
 * all budget period creation and extension functions.
 */

import { PeriodType, SourcePeriod } from '../../../types';
import * as admin from 'firebase-admin';

/**
 * Days in a standard week
 */
const DAYS_IN_WEEK = 7;

/**
 * Calculate the number of days in a period
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
 * Calculate allocation for a monthly budget to any target period
 * Handles periods that span multiple months by calculating day-by-day
 */
function calculateMonthlyToTarget(
  monthlyAmount: number,
  targetPeriod: SourcePeriod
): number {
  const startDate = targetPeriod.startDate.toDate();
  const endDate = targetPeriod.endDate.toDate();

  let totalAllocation = 0;
  const currentDate = new Date(startDate);

  // Iterate through each day in the target period
  while (currentDate <= endDate) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); // 0-indexed
    const daysInCurrentMonth = getDaysInMonth(year, month);
    const dailyRateForMonth = monthlyAmount / daysInCurrentMonth;

    totalAllocation += dailyRateForMonth;

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  console.log(
    `[calculateMonthlyToTarget] Monthly: $${monthlyAmount}, ` +
    `Target: ${targetPeriod.id} (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}), ` +
    `Allocation: $${totalAllocation.toFixed(2)}`
  );

  return totalAllocation;
}

/**
 * Calculate the allocated budget amount for a specific period based on actual days
 *
 * Converts budget amounts between period types using day-based calculations:
 * - If budget is MONTHLY → iterates day-by-day, applying each month's daily rate
 * - If budget is WEEKLY → converting to other types uses (target period days / 7) * weekly amount
 * - If budget is BI_MONTHLY → converting to other types uses (target period days / bi-monthly days) * amount
 *
 * This ensures spending aligns correctly regardless of which view the user is looking at,
 * and properly handles periods that span multiple months.
 *
 * @param budgetAmount - The budget amount in its original period type
 * @param budgetPeriodType - The period type of the budget blueprint (MONTHLY, BI_MONTHLY, WEEKLY)
 * @param targetPeriod - The target source period to calculate allocation for
 * @returns The allocated amount for the target period
 *
 * @example
 * ```typescript
 * // February has 28 days, budget is $28/month ($1/day)
 * // Bi-monthly period 1 (Feb 1-15) = 15 days → $15
 * // Bi-monthly period 2 (Feb 16-28) = 13 days → $13
 *
 * // Week spanning Feb-Mar: $28/Feb (28 days) and $31/Mar (31 days)
 * // Week with 3 days in Feb + 4 days in Mar:
 * //   - 3 days × ($28/28) = 3 days × $1.00/day = $3.00
 * //   - 4 days × ($31/31) = 4 days × $1.00/day = $4.00
 * //   - Total: $7.00
 * ```
 */
export function calculatePeriodAllocatedAmount(
  budgetAmount: number,
  budgetPeriodType: PeriodType,
  targetPeriod: SourcePeriod
): number {
  const targetDays = getDaysInPeriod(targetPeriod.startDate, targetPeriod.endDate);

  // If budget and target are same type, return the budget amount
  if (budgetPeriodType === targetPeriod.type) {
    return budgetAmount;
  }

  let allocation: number;

  switch (budgetPeriodType) {
    case PeriodType.MONTHLY:
      // For monthly budgets, use day-by-day calculation to handle month-spanning periods
      allocation = calculateMonthlyToTarget(budgetAmount, targetPeriod);
      break;

    case PeriodType.BI_MONTHLY:
      // For bi-monthly budgets, calculate daily rate from the bi-monthly period
      // Get actual bi-monthly period days based on metadata
      const biMonthlyDays = targetPeriod.metadata?.biMonthlyHalf === 1 ? 15 :
        (targetPeriod.metadata?.month ? getDaysInMonth(targetPeriod.year, targetPeriod.metadata.month - 1) - 15 : 15);
      const biMonthlyDailyRate = budgetAmount / biMonthlyDays;
      allocation = biMonthlyDailyRate * targetDays;

      console.log(
        `[calculatePeriodAllocatedAmount] Bi-monthly: $${budgetAmount} (${biMonthlyDays} days), ` +
        `Target: ${targetPeriod.id} (${targetDays} days), Daily rate: $${biMonthlyDailyRate.toFixed(2)}, ` +
        `Allocation: $${allocation.toFixed(2)}`
      );
      break;

    case PeriodType.WEEKLY:
      // For weekly budgets, divide by 7 to get daily rate
      const weeklyDailyRate = budgetAmount / DAYS_IN_WEEK;
      allocation = weeklyDailyRate * targetDays;

      console.log(
        `[calculatePeriodAllocatedAmount] Weekly: $${budgetAmount}, ` +
        `Target: ${targetPeriod.id} (${targetDays} days), Daily rate: $${weeklyDailyRate.toFixed(2)}, ` +
        `Allocation: $${allocation.toFixed(2)}`
      );
      break;

    default:
      console.warn(
        `[calculatePeriodAllocatedAmount] Unknown budget period type: ${budgetPeriodType}, using target days`
      );
      const defaultDailyRate = budgetAmount / targetDays;
      allocation = defaultDailyRate * targetDays;
  }

  return allocation;
}

/**
 * Calculate daily rate for a budget amount and period type
 *
 * @param budgetAmount - The budget amount
 * @param budgetPeriodType - The period type of the budget
 * @param periodDays - Optional: specific days in the period (for bi-monthly/monthly)
 * @returns Daily spending rate
 */
export function getDailyRate(
  budgetAmount: number,
  budgetPeriodType: PeriodType,
  periodDays?: number
): number {
  switch (budgetPeriodType) {
    case PeriodType.MONTHLY:
      // Use provided period days or default to 30
      return budgetAmount / (periodDays || 30);
    case PeriodType.BI_MONTHLY:
      // Use provided period days or default to 15
      return budgetAmount / (periodDays || 15);
    case PeriodType.WEEKLY:
      return budgetAmount / DAYS_IN_WEEK;
    default:
      return budgetAmount / (periodDays || 30);
  }
}
