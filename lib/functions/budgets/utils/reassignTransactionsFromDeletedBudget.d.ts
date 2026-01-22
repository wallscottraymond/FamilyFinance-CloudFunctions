/**
 * Reassign Transactions from Deleted Budget Utility
 *
 * Automatically reassigns all transactions from a deleted budget to:
 * 1. Date-matched active budgets (preferred)
 * 2. "Everything Else" system budget (fallback)
 * 3. 'unassigned' (if no budgets exist)
 *
 * Key Features:
 * - Batch processing (respects 500-doc Firestore limit)
 * - Multi-split support (only reassigns splits from deleted budget)
 * - Graceful error handling (continues on partial failures)
 * - Comprehensive logging and statistics
 *
 * Called by: onBudgetDelete trigger after soft delete
 */
export interface ReassignmentResult {
    success: boolean;
    transactionsReassigned: number;
    budgetAssignments: Record<string, number>;
    batchCount: number;
    errors: string[];
    error?: string;
}
/**
 * Reassign all transactions from deleted budget to active budgets
 *
 * @param deletedBudgetId - ID of the deleted budget
 * @param userId - User ID (owner of transactions)
 * @returns Reassignment statistics and errors
 */
export declare function reassignTransactionsFromDeletedBudget(deletedBudgetId: string, userId: string): Promise<ReassignmentResult>;
//# sourceMappingURL=reassignTransactionsFromDeletedBudget.d.ts.map