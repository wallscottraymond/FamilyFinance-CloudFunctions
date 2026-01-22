/**
 * Transaction Split Assignment - Centralized Logic
 *
 * This utility provides a single, consistent interface for assigning transaction splits
 * to budgets. It orchestrates the complete split validation and assignment pipeline:
 *
 * 1. Validate budget IDs exist and are active (auto-fix invalid IDs)
 * 2. Validate split amounts total to transaction amount (auto-redistribute if needed)
 * 3. Match splits to user's budgets based on date ranges and categories
 *
 * This centralized approach ensures consistency across all transaction operations:
 * - createTransaction (before save)
 * - updateTransaction (before save)
 * - onTransactionUpdate (safety net, after save)
 *
 * @module assignTransactionSplits
 */
import { Transaction } from '../../../types';
/**
 * Result of transaction split assignment operation
 */
export interface AssignSplitsResult {
    /** Updated transaction with validated and assigned splits */
    transaction: Transaction;
    /** Whether any changes were made to the splits */
    modified: boolean;
    /** Details about what was changed */
    changes: {
        /** Number of budgetIds that were auto-fixed */
        budgetIdsFixed: number;
        /** Whether split amounts were redistributed */
        amountsRedistributed: boolean;
        /** Number of splits reassigned to different budgets */
        budgetsReassigned: number;
    };
}
/**
 * Assign transaction splits to budgets with full validation and matching
 *
 * This is the centralized function for all split assignment operations. It ensures
 * that splits are valid, properly distributed, and correctly assigned to budgets.
 *
 * **Pipeline Steps:**
 * 1. **Validate Budget IDs:** Check that all budgetIds reference valid, active budgets.
 *    Invalid IDs are auto-fixed to the user's "Everything Else" budget.
 * 2. **Validate Split Amounts:** Ensure splits total to transaction amount.
 *    Auto-redistributes proportionally if totals don't match (within $0.01 tolerance).
 * 3. **Match to Budgets:** Assign splits to budgets based on transaction date,
 *    budget date ranges, and category matching. Falls back to "Everything Else".
 *
 * **Thread Safety:** This function is idempotent and safe to call multiple times
 * on the same transaction. Subsequent calls will return the same result if no
 * budgets have changed.
 *
 * **Error Handling:** All errors are caught and logged. On error, returns the
 * original transaction with `modified: false` to avoid blocking operations.
 *
 * @param transaction - Transaction to process
 * @param userId - User ID for querying user-specific budgets
 * @returns Result with updated transaction and change details
 *
 * @example
 * ```typescript
 * // Before saving a new transaction
 * const result = await assignTransactionSplits(newTransaction, userId);
 * if (result.modified) {
 *   console.log('Splits were modified:', result.changes);
 * }
 * await saveTransaction(result.transaction);
 * ```
 *
 * @example
 * ```typescript
 * // In a trigger (safety net for invalid data)
 * const result = await assignTransactionSplits(existingTransaction, userId);
 * if (result.modified) {
 *   console.log('Auto-fixed invalid splits');
 *   await updateTransaction(result.transaction);
 * }
 * ```
 */
export declare function assignTransactionSplits(transaction: Transaction, userId: string): Promise<AssignSplitsResult>;
/**
 * Assign splits for multiple transactions in batch
 *
 * More efficient than calling assignTransactionSplits repeatedly for large
 * transaction sets, as it can reuse budget queries across transactions.
 *
 * @param transactions - Array of transactions to process
 * @param userId - User ID for querying user-specific budgets
 * @returns Array of results, one per transaction
 *
 * @example
 * ```typescript
 * const results = await assignTransactionSplitsBatch(plaidTransactions, userId);
 * const modifiedCount = results.filter(r => r.modified).length;
 * console.log(`${modifiedCount} of ${results.length} transactions modified`);
 * ```
 */
export declare function assignTransactionSplitsBatch(transactions: Transaction[], userId: string): Promise<AssignSplitsResult[]>;
//# sourceMappingURL=assignTransactionSplits.d.ts.map