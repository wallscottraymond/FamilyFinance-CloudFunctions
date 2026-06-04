/**
 * Transaction-to-Budget Matching Utility
 *
 * Matches transactions to budgets based on date range.
 * Instead of matching to specific budget periods, matches to the parent budget ID.
 * This allows transactions to be tracked across all period types (weekly, monthly, etc.)
 * that share the same budget.
 *
 * @module transactions/utils/match_transaction_to_budget
 */
/**
 * Match a transaction to a budget based on its date and category
 *
 * @param user_id - User ID
 * @param transaction_date - Date of the transaction
 * @returns Budget match information (budget_id, budget_name)
 */
export declare function match_transaction_to_budget(user_id: string, transaction_date: Date): Promise<{
    budget_id: string | undefined;
    budget_name: string;
}>;
export declare function matchTransactionToBudget(userId: string, transactionDate: Date): Promise<{
    budgetId: string | undefined;
    budgetName: string;
}>;
//# sourceMappingURL=match_transaction_to_budget.d.ts.map