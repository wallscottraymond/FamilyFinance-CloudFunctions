/**
 * Extend Budget Periods Range
 *
 * This callable function extends budget_periods for multiple periods at once
 * to improve performance when users are scrolling through periods. Instead of
 * creating periods one-at-a-time, this function creates them in batches.
 *
 * Features:
 * - Batch period generation (create multiple periods in one call)
 * - Smart period selection (only creates missing periods)
 * - Handles all period types (weekly, bi-monthly, monthly)
 * - User permission validation
 * - Efficient batch writes
 *
 * Memory: 512MiB, Timeout: 60s (increased for batch processing)
 */
import { PeriodType } from '../../../../types';
interface ExtendBudgetPeriodsRangeRequest {
    startPeriodId: string;
    endPeriodId: string;
    periodType: PeriodType;
    familyId?: string;
    maxPeriods?: number;
}
interface ExtendBudgetPeriodsRangeResponse {
    success: boolean;
    budgetPeriodsCreated: number;
    budgetsExtended: string[];
    periodsProcessed: string[];
    skippedPeriods: string[];
    error?: string;
}
/**
 * Extend budget periods to cover a range of periods
 * Called proactively when frontend detects user approaching periods without budget data
 */
export declare const extendBudgetPeriodsRange: import("firebase-functions/v2/https").CallableFunction<ExtendBudgetPeriodsRangeRequest, Promise<ExtendBudgetPeriodsRangeResponse>>;
export {};
//# sourceMappingURL=extendBudgetPeriodsRange.d.ts.map