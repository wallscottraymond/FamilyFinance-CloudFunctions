/**
 * Budget Spending Update Utility
 *
 * Handles updating budget_periods spent amounts when transactions are created, updated, or deleted.
 *
 * Uses date-based period assignment: transactions are only applied to budget periods where
 * the transaction date falls within the period's start and end dates (inclusive).
 *
 * Also provides recalculation functionality when budgets are created to include historical transactions.
 */
import { Transaction, Budget } from '../types';
interface UpdateBudgetSpendingParams {
    oldTransaction?: Transaction;
    newTransaction?: Transaction;
    userId: string;
    groupId?: string | null;
}
interface BudgetSpendingResult {
    budgetPeriodsUpdated: number;
    budgetsAffected: string[];
    errors: string[];
    periodTypesUpdated: {
        weekly: number;
        bi_monthly: number;
        monthly: number;
    };
}
/**
 * Main entry point for updating budget spending based on transaction changes
 *
 * Updates only budget periods where the transaction date falls within the period's date range
 */
export declare function updateBudgetSpending(params: UpdateBudgetSpendingParams): Promise<BudgetSpendingResult>;
/**
 * Recalculate budget spending when a new budget is created
 *
 * Finds ALL existing approved expense transactions that match the budget's categories
 * and assigns spending to budget periods based on transaction dates.
 * Each transaction is only applied to periods where the transaction date falls within the period's date range.
 */
export declare function recalculateBudgetSpendingOnCreate(budgetId: string, budget: Budget): Promise<{
    transactionsProcessed: number;
    totalSpending: number;
    budgetPeriodsUpdated: number;
    periodTypesUpdated: {
        weekly: number;
        bi_monthly: number;
        monthly: number;
    };
    errors: string[];
}>;
export {};
//# sourceMappingURL=budgetSpending.d.ts.map