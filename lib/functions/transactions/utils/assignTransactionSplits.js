"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignTransactionSplits = assignTransactionSplits;
exports.assignTransactionSplitsBatch = assignTransactionSplitsBatch;
const validateBudgetIds_1 = require("./validateBudgetIds");
const validateAndRedistributeSplits_1 = require("./validateAndRedistributeSplits");
const matchTransactionSplitsToBudgets_1 = require("./matchTransactionSplitsToBudgets");
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
async function assignTransactionSplits(transaction, userId) {
    console.log(`[assignTransactionSplits] Processing transaction ${transaction.id || 'new'} for user ${userId}`);
    const originalSplits = JSON.stringify(transaction.splits);
    let currentTransaction = Object.assign({}, transaction);
    const changes = {
        budgetIdsFixed: 0,
        amountsRedistributed: false,
        budgetsReassigned: 0
    };
    try {
        // ===== STEP 1: Validate and Fix Budget IDs =====
        console.log(`[assignTransactionSplits] Step 1/3: Validating ${currentTransaction.splits.length} budget IDs`);
        const validatedSplits = await (0, validateBudgetIds_1.validateAndFixBudgetIds)(userId, currentTransaction.splits);
        // Count how many budgetIds were fixed
        changes.budgetIdsFixed = currentTransaction.splits.filter((split, index) => split.budgetId !== validatedSplits[index].budgetId).length;
        currentTransaction = Object.assign(Object.assign({}, currentTransaction), { splits: validatedSplits });
        if (changes.budgetIdsFixed > 0) {
            console.log(`[assignTransactionSplits] Fixed ${changes.budgetIdsFixed} invalid budget IDs`);
        }
        // ===== STEP 2: Validate and Redistribute Split Amounts =====
        console.log('[assignTransactionSplits] Step 2/3: Validating split amounts');
        // Calculate transaction total (sum of all splits or explicit amount field)
        const transactionAmount = currentTransaction.splits.reduce((sum, split) => sum + split.amount, 0);
        const validationResult = (0, validateAndRedistributeSplits_1.validateAndRedistributeSplits)(transactionAmount, currentTransaction.splits);
        if (!validationResult.isValid && validationResult.redistributedSplits) {
            console.log('[assignTransactionSplits] Split amounts redistributed to match transaction total');
            changes.amountsRedistributed = true;
            currentTransaction = Object.assign(Object.assign({}, currentTransaction), { splits: validationResult.redistributedSplits });
        }
        else {
            console.log('[assignTransactionSplits] Split amounts valid ✓');
        }
        // ===== STEP 3: Match Splits to Budgets =====
        console.log('[assignTransactionSplits] Step 3/3: Matching splits to budgets');
        // matchTransactionSplitsToBudgets expects an array of transactions
        const matchedTransactions = await (0, matchTransactionSplitsToBudgets_1.matchTransactionSplitsToBudgets)([currentTransaction], userId);
        const matchedTransaction = matchedTransactions[0];
        // Count how many budgets were reassigned
        changes.budgetsReassigned = currentTransaction.splits.filter((split, index) => split.budgetId !== matchedTransaction.splits[index].budgetId).length;
        currentTransaction = matchedTransaction;
        if (changes.budgetsReassigned > 0) {
            console.log(`[assignTransactionSplits] Reassigned ${changes.budgetsReassigned} splits to different budgets`);
        }
        // ===== DETERMINE IF CHANGES WERE MADE =====
        const modified = JSON.stringify(currentTransaction.splits) !== originalSplits;
        console.log(`[assignTransactionSplits] Processing complete. Modified: ${modified}`);
        if (modified) {
            console.log('[assignTransactionSplits] Changes:', changes);
        }
        return {
            transaction: currentTransaction,
            modified,
            changes
        };
    }
    catch (error) {
        console.error('[assignTransactionSplits] Error processing splits:', error);
        // On error, return original transaction to avoid blocking operations
        return {
            transaction,
            modified: false,
            changes: {
                budgetIdsFixed: 0,
                amountsRedistributed: false,
                budgetsReassigned: 0
            }
        };
    }
}
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
async function assignTransactionSplitsBatch(transactions, userId) {
    console.log(`[assignTransactionSplitsBatch] Processing ${transactions.length} transactions for user ${userId}`);
    const results = [];
    for (const transaction of transactions) {
        const result = await assignTransactionSplits(transaction, userId);
        results.push(result);
    }
    const modifiedCount = results.filter(r => r.modified).length;
    console.log(`[assignTransactionSplitsBatch] Complete. ${modifiedCount} of ${transactions.length} transactions modified`);
    return results;
}
//# sourceMappingURL=assignTransactionSplits.js.map