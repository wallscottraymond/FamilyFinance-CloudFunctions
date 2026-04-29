/**
 * Update Budget Period Amount
 *
 * Callable function to update a budget period's amount with proper cascade
 * to non-prime periods. Supports two modes:
 * - 'this_period': Update single period + cascade to referencing non-primes
 * - 'all_forward': Update budget base amount + all current/future periods
 *
 * Key features:
 * - Blocks updates to past/historical periods
 * - Atomic transaction for all updates
 * - Proper cascade to non-prime periods using SUMPRODUCT
 * - Recalculates dailyRate, remaining, and primePeriodBreakdown
 *
 * Memory: 512MiB, Timeout: 60s
 */
type CascadeScope = 'this_period' | 'all_forward';
interface UpdateBudgetPeriodAmountRequest {
    budgetPeriodId: string;
    newAmount: number;
    cascadeScope: CascadeScope;
}
interface UpdateBudgetPeriodAmountResponse {
    success: boolean;
    periodsUpdated: number;
    budgetUpdated: boolean;
    warnings: string[];
    error?: string;
}
export declare const updateBudgetPeriodAmount: import("firebase-functions/v2/https").CallableFunction<UpdateBudgetPeriodAmountRequest, Promise<UpdateBudgetPeriodAmountResponse>, unknown>;
export {};
//# sourceMappingURL=updateBudgetPeriodAmount.d.ts.map