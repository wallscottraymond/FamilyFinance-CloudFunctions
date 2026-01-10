/**
 * Historical Transaction Recalculation Utility
 *
 * Updates both transaction.splits[].budgetId AND budget_periods.spent
 * when a new budget is created with historical date ranges.
 *
 * This fixes the mismatch where budget_periods.spent updates but
 * transaction.splits[].budgetId doesn't.
 */
import { Timestamp } from 'firebase-admin/firestore';
/**
 * Recalculate historical transactions and budget spending for a new budget
 *
 * @param budgetId - Budget ID
 * @param userId - User ID
 * @param categoryIds - Categories this budget tracks
 * @param startDate - Budget start date
 * @param endDate - Budget end date (null for ongoing budgets)
 * @returns Object with counts of transactions and budget periods updated
 */
export declare function recalculateHistoricalTransactions(budgetId: string, userId: string, categoryIds: string[], startDate: Timestamp, endDate: Timestamp | null): Promise<{
    transactionsUpdated: number;
    spendingUpdated: number;
}>;
/**
 * Recalculate budget spending for existing transactions (legacy function)
 *
 * This is the original implementation that only updates budget_periods.spent
 * without updating transaction.splits[].budgetId.
 *
 * @deprecated Use recalculateHistoricalTransactions instead
 */
export declare function recalculateBudgetSpendingOnCreate(budgetId: string, userId: string, categoryIds: string[], startDate: Timestamp, endDate: Timestamp | null): Promise<number>;
//# sourceMappingURL=recalculateHistoricalTransactions.d.ts.map