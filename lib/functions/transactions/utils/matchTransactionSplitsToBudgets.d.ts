/**
 * Transaction Splits to Budgets Matching Utility (In-Memory Processing)
 *
 * Matches transaction splits to budgets based on date range AND category.
 * Operates in-memory on transaction arrays (no DB writes).
 *
 * Matching Priority:
 * 1. Regular budgets: Must match BOTH date range AND category
 * 2. "Everything Else" budget: Fallback for unmatched transactions
 * 3. Unassigned: Only if no "Everything Else" budget exists
 */
import { Transaction as FamilyTransaction } from '../../../types';
/**
 * Match transaction splits to budgets based on transaction dates AND categories (in-memory)
 *
 * Queries budgets by date range and updates each transaction's splits
 * with matching budgetId and budgetName fields.
 *
 * @param transactions - Array of transactions to match
 * @param userId - User ID for querying user-specific budgets
 * @returns Modified array of transactions with budget info populated in splits
 */
export declare function matchTransactionSplitsToBudgets(transactions: FamilyTransaction[], userId: string): Promise<FamilyTransaction[]>;
//# sourceMappingURL=matchTransactionSplitsToBudgets.d.ts.map