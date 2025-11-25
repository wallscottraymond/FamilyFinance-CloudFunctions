/**
 * Transaction Splits to Budgets Matching Utility (In-Memory Processing)
 *
 * Matches transaction splits to budgets based on date range.
 * Operates in-memory on transaction arrays (no DB writes).
 */
import { Transaction as FamilyTransaction } from '../../../types';
/**
 * Match transaction splits to budgets based on transaction dates (in-memory)
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