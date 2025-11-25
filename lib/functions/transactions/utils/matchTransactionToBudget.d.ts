/**
 * Transaction-to-Budget Matching Utility
 *
 * Matches transactions to budgets based on date range.
 * Instead of matching to specific budget periods, matches to the parent budget ID.
 * This allows transactions to be tracked across all period types (weekly, monthly, etc.)
 * that share the same budget.
 */
/**
 * Match a transaction to a budget based on its date and category
 *
 * @param userId - User ID
 * @param transactionDate - Date of the transaction
 * @returns Budget match information (budgetId, budgetName)
 */
export declare function matchTransactionToBudget(userId: string, transactionDate: Date): Promise<{
    budgetId: string | undefined;
    budgetName: string;
}>;
//# sourceMappingURL=matchTransactionToBudget.d.ts.map