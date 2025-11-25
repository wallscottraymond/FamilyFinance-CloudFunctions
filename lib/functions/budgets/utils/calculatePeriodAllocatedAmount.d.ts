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
export declare function calculatePeriodAllocatedAmount(budgetAmount: number, budgetPeriodType: PeriodType, targetPeriod: SourcePeriod): number;
/**
 * Calculate daily rate for a budget amount and period type
 *
 * @param budgetAmount - The budget amount
 * @param budgetPeriodType - The period type of the budget
 * @param periodDays - Optional: specific days in the period (for bi-monthly/monthly)
 * @returns Daily spending rate
 */
export declare function getDailyRate(budgetAmount: number, budgetPeriodType: PeriodType, periodDays?: number): number;
//# sourceMappingURL=calculatePeriodAllocatedAmount.d.ts.map