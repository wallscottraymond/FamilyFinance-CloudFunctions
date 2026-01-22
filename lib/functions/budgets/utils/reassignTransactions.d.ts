/**
 * Transaction Reassignment Utility
 *
 * Reassigns transactions when budget categories change.
 * - Category Additions: Picks up unassigned transactions matching new categories
 * - Category Removals: Re-evaluates ALL splits in affected transactions (not just removed category)
 *
 * Key Features:
 * - Full transaction re-evaluation on category removal (user requirement)
 * - Batch processing (respects 500-doc Firestore limit)
 * - Comprehensive logging and statistics
 *
 * Called by: onBudgetUpdate trigger when categoryIds change
 */
/**
 * Category change information
 */
export interface CategoryChange {
    categoriesAdded: string[];
    categoriesRemoved: string[];
}
/**
 * Reassignment statistics
 */
export interface ReassignmentStats {
    success: boolean;
    transactionsReassigned: number;
    splitsReassigned: number;
    errors: string[];
}
/**
 * Reassign transactions when budget categories change (ENHANCED VERSION)
 *
 * This function handles two scenarios:
 * 1. Category Additions: Picks up transactions with unassigned splits matching new categories
 * 2. Category Removals: Re-evaluates ALL splits in affected transactions (not just removed category)
 *
 * @param budgetId - Budget ID whose transactions need reassignment
 * @param userId - User ID for querying user-specific transactions
 * @param changes - Categories added/removed
 * @returns Reassignment statistics
 */
export declare function reassignTransactionsForBudget(budgetId: string, userId: string, changes?: CategoryChange): Promise<number | ReassignmentStats>;
/**
 * Reassign all transactions for all budgets (useful for bulk operations)
 *
 * @param userId - User ID
 * @returns Total count of transactions reassigned
 */
export declare function reassignAllTransactions(userId: string): Promise<number>;
//# sourceMappingURL=reassignTransactions.d.ts.map