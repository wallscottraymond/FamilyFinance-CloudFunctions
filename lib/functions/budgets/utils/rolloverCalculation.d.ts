/**
 * Budget Rollover Calculation Utility
 *
 * Handles real-time calculation of rollover amounts between budget periods.
 * Rollover carries surplus (underspend) or deficit (overspend) from previous periods.
 *
 * Key behaviors:
 * - Per-budget settings override global user preferences
 * - Both prime and non-prime periods calculate rollover independently
 * - Spread strategy distributes overspend across multiple periods (max 6)
 * - Extreme overspend can result in negative remaining amounts
 */
import { Budget, BudgetPeriodDocument, RolloverStrategy, FinancialSettings } from '../../../types';
/**
 * Rollover settings resolved from budget or user preferences
 */
export interface ResolvedRolloverSettings {
    enabled: boolean;
    strategy: RolloverStrategy;
    spreadPeriods: number;
}
/**
 * Result of rollover calculation for a period
 */
export interface RolloverCalculationResult {
    /** Amount to add/subtract from this period's budget (positive = surplus, negative = deficit) */
    rolledOverAmount: number;
    /** ID of the period this rollover came from */
    rolledOverFromPeriodId: string | null;
    /** For spread: remaining amount to deduct from future periods */
    pendingRolloverDeduction: number;
    /** For spread: number of periods remaining for deduction */
    pendingRolloverPeriods: number;
}
/**
 * Get effective rollover settings for a budget.
 * Per-budget settings take precedence over global user preferences.
 *
 * @param budget - The budget document
 * @param userFinancialSettings - User's global financial settings (optional)
 * @returns Resolved rollover settings
 */
export declare function getEffectiveRolloverSettings(budget: Budget, userFinancialSettings?: Partial<FinancialSettings>): ResolvedRolloverSettings;
/**
 * Calculate the rollover amount for a budget period.
 *
 * This function performs real-time calculation based on the previous period's
 * spending and any pending spread deductions.
 *
 * @param currentPeriod - The period to calculate rollover for
 * @param previousPeriod - The previous period of the same type (null for first period)
 * @param rolloverSettings - Resolved rollover settings for this budget
 * @returns Rollover calculation result
 */
export declare function calculateRolloverForPeriod(currentPeriod: BudgetPeriodDocument, previousPeriod: BudgetPeriodDocument | null, rolloverSettings: ResolvedRolloverSettings): RolloverCalculationResult;
/**
 * Calculate the effective remaining amount for a period, including rollover.
 *
 * @param period - The budget period
 * @returns Effective remaining amount
 */
export declare function calculateEffectiveRemaining(period: BudgetPeriodDocument): number;
/**
 * Find the previous period of the same type for a given period.
 *
 * @param periods - Array of budget periods sorted by periodStart descending
 * @param currentPeriod - The current period
 * @returns The previous period of the same type, or null if none exists
 */
export declare function findPreviousPeriodOfSameType(periods: BudgetPeriodDocument[], currentPeriod: BudgetPeriodDocument): BudgetPeriodDocument | null;
/**
 * Check if a period is in the past (ended before today).
 *
 * @param period - The budget period
 * @returns True if the period has ended
 */
export declare function isPeriodInPast(period: BudgetPeriodDocument): boolean;
//# sourceMappingURL=rolloverCalculation.d.ts.map