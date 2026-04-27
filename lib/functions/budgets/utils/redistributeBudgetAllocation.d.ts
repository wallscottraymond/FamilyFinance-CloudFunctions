/**
 * Redistribute Budget Allocation Utility
 *
 * Handles allocation redistribution when a budget is paused (isActive=false).
 * When a budget is paused, its current period's allocation is redistributed
 * to the "Everything Else" budget's corresponding period.
 *
 * When a budget is resumed (isActive=true), the allocation is reclaimed
 * from Everything Else and restored to the budget.
 *
 * This only affects the CURRENT period - future periods auto-resume.
 */
import * as admin from 'firebase-admin';
export interface RedistributionResult {
    success: boolean;
    action: 'paused' | 'resumed' | 'none';
    budgetPeriodId: string | null;
    everythingElsePeriodId: string | null;
    amountRedistributed: number;
    error: string | null;
}
/**
 * Redistribute budget allocation when pausing/resuming a budget
 *
 * @param db - Firestore instance
 * @param budgetId - The budget being paused/resumed
 * @param userId - The user who owns the budget
 * @param isPausing - true if pausing (isActive going false), false if resuming
 * @returns Result of the redistribution operation
 */
export declare function redistributeBudgetAllocation(db: admin.firestore.Firestore, budgetId: string, userId: string, isPausing: boolean): Promise<RedistributionResult>;
//# sourceMappingURL=redistributeBudgetAllocation.d.ts.map