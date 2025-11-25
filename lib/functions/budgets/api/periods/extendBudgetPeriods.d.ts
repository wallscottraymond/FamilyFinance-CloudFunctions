/**
 * Extend Budget Periods (Simplified)
 *
 * This callable function handles rare cases where budget periods need to be created
 * for existing budgets. Since periods are now created upfront, this should rarely be needed.
 *
 * Features:
 * - Simple period generation for edge cases
 * - Handles single period requests
 * - User permission validation
 *
 * Memory: 256MiB, Timeout: 30s
 */
interface ExtendBudgetPeriodsRequest {
    periodId: string;
    familyId?: string;
}
interface ExtendBudgetPeriodsResponse {
    success: boolean;
    budgetPeriodsCreated: number;
    budgetsExtended: string[];
    error?: string;
}
/**
 * Extend budget periods to cover a specific period
 * Called when frontend needs budget data for a period that doesn't exist yet
 */
export declare const extendBudgetPeriods: import("firebase-functions/v2/https").CallableFunction<ExtendBudgetPeriodsRequest, Promise<ExtendBudgetPeriodsResponse>>;
export {};
//# sourceMappingURL=extendBudgetPeriods.d.ts.map