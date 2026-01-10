/**
 * Transaction Reassignment Utility
 *
 * Reassigns transactions when budget categories change.
 * Queries all transactions assigned to a budget and reassigns them based on current rules.
 */
/**
 * Reassign all transactions for a specific budget
 *
 * Used when budget categories change - finds all transactions assigned to the budget
 * and reassigns them based on current category matching rules.
 *
 * @param budgetId - Budget ID whose transactions need reassignment
 * @param userId - User ID for querying user-specific transactions
 * @returns Count of transactions reassigned
 */
export declare function reassignTransactionsForBudget(budgetId: string, userId: string): Promise<number>;
/**
 * Reassign all transactions for all budgets (useful for bulk operations)
 *
 * @param userId - User ID
 * @returns Total count of transactions reassigned
 */
export declare function reassignAllTransactions(userId: string): Promise<number>;
//# sourceMappingURL=reassignTransactions.d.ts.map