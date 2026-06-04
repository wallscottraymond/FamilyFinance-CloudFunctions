/**
 * Transaction Splits to Budgets Matching Utility (In-Memory Processing)
 *
 * Matches transaction splits to budgets based on date range AND category.
 * Operates in-memory on transaction arrays (no DB writes).
 *
 * Matching Logic:
 * - ALL budgets (including "Everything Else") match by date range AND category
 * - "Everything Else" budget owns all unassigned categories, so it will naturally
 *   match transactions that don't match any other budget's categories
 * - First matching budget wins (no priority ordering)
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