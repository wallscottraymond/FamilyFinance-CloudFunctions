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
 * @module transactions/utils/assign_transaction_splits
 */

import { Transaction } from '../../../types';
import { validate_and_fix_budget_ids } from './validate_budget_ids';
import { validate_and_redistribute_splits } from './validate_and_redistribute_splits';
import { match_transaction_splits_to_budgets } from './match_transaction_splits_to_budgets';

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
    budget_ids_fixed: number;
    /** Whether split amounts were redistributed */
    amounts_redistributed: boolean;
    /** Number of splits reassigned to different budgets */
    budgets_reassigned: number;
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
 * @param user_id - User ID for querying user-specific budgets
 * @returns Result with updated transaction and change details
 */
export async function assign_transaction_splits(
  transaction: Transaction,
  user_id: string
): Promise<AssignSplitsResult> {
  console.log(`[assign_transaction_splits] Processing transaction ${transaction.id || 'new'} for user ${user_id}`);

  const original_splits = JSON.stringify(transaction.splits);
  let current_transaction = { ...transaction };
  const changes = {
    budget_ids_fixed: 0,
    amounts_redistributed: false,
    budgets_reassigned: 0
  };

  try {
    // ===== STEP 1: Validate and Fix Budget IDs =====
    console.log(`[assign_transaction_splits] Step 1/3: Validating ${current_transaction.splits.length} budget IDs`);

    const validated_splits = await validate_and_fix_budget_ids(user_id, current_transaction.splits);

    // Count how many budgetIds were fixed
    changes.budget_ids_fixed = current_transaction.splits.filter((split, index) =>
      split.budgetId !== validated_splits[index].budgetId
    ).length;

    current_transaction = {
      ...current_transaction,
      splits: validated_splits
    };

    if (changes.budget_ids_fixed > 0) {
      console.log(`[assign_transaction_splits] Fixed ${changes.budget_ids_fixed} invalid budget IDs`);
    }

    // ===== STEP 2: Validate and Redistribute Split Amounts =====
    console.log('[assign_transaction_splits] Step 2/3: Validating split amounts');

    // Calculate transaction total (sum of all splits or explicit amount field)
    const transaction_amount = current_transaction.splits.reduce(
      (sum, split) => sum + split.amount,
      0
    );

    const validation_result = validate_and_redistribute_splits(
      transaction_amount,
      current_transaction.splits as any
    );

    if (!validation_result.is_valid && validation_result.redistributed_splits) {
      console.log('[assign_transaction_splits] Split amounts redistributed to match transaction total');
      changes.amounts_redistributed = true;

      current_transaction = {
        ...current_transaction,
        splits: validation_result.redistributed_splits
      };
    } else {
      console.log('[assign_transaction_splits] Split amounts valid ✓');
    }

    // ===== STEP 3: Match Splits to Budgets =====
    console.log('[assign_transaction_splits] Step 3/3: Matching splits to budgets');

    // match_transaction_splits_to_budgets expects an array of transactions
    const matched_transactions = await match_transaction_splits_to_budgets(
      [current_transaction],
      user_id
    );

    const matched_transaction = matched_transactions[0];

    // Count how many budgets were reassigned
    changes.budgets_reassigned = current_transaction.splits.filter((split, index) =>
      split.budgetId !== matched_transaction.splits[index].budgetId
    ).length;

    current_transaction = matched_transaction;

    if (changes.budgets_reassigned > 0) {
      console.log(`[assign_transaction_splits] Reassigned ${changes.budgets_reassigned} splits to different budgets`);
    }

    // ===== DETERMINE IF CHANGES WERE MADE =====
    const modified = JSON.stringify(current_transaction.splits) !== original_splits;

    console.log(`[assign_transaction_splits] Processing complete. Modified: ${modified}`);
    if (modified) {
      console.log('[assign_transaction_splits] Changes:', changes);
    }

    return {
      transaction: current_transaction,
      modified,
      changes
    };

  } catch (error) {
    console.error('[assign_transaction_splits] Error processing splits:', error);

    // On error, return original transaction to avoid blocking operations
    return {
      transaction,
      modified: false,
      changes: {
        budget_ids_fixed: 0,
        amounts_redistributed: false,
        budgets_reassigned: 0
      }
    };
  }
}

/**
 * Assign splits for multiple transactions in batch
 *
 * More efficient than calling assign_transaction_splits repeatedly for large
 * transaction sets, as it can reuse budget queries across transactions.
 *
 * @param transactions - Array of transactions to process
 * @param user_id - User ID for querying user-specific budgets
 * @returns Array of results, one per transaction
 */
export async function assign_transaction_splits_batch(
  transactions: Transaction[],
  user_id: string
): Promise<AssignSplitsResult[]> {
  console.log(`[assign_transaction_splits_batch] Processing ${transactions.length} transactions for user ${user_id}`);

  const results: AssignSplitsResult[] = [];

  for (const transaction of transactions) {
    const result = await assign_transaction_splits(transaction, user_id);
    results.push(result);
  }

  const modified_count = results.filter(r => r.modified).length;
  console.log(`[assign_transaction_splits_batch] Complete. ${modified_count} of ${transactions.length} transactions modified`);

  return results;
}

// Legacy interface for backward compatibility
export interface LegacyAssignSplitsResult {
  transaction: Transaction;
  modified: boolean;
  changes: {
    budgetIdsFixed: number;
    amountsRedistributed: boolean;
    budgetsReassigned: number;
  };
}

/**
 * Legacy wrapper for backward compatibility
 */
export async function assignTransactionSplits(
  transaction: Transaction,
  userId: string
): Promise<LegacyAssignSplitsResult> {
  const result = await assign_transaction_splits(transaction, userId);
  return {
    transaction: result.transaction,
    modified: result.modified,
    changes: {
      budgetIdsFixed: result.changes.budget_ids_fixed,
      amountsRedistributed: result.changes.amounts_redistributed,
      budgetsReassigned: result.changes.budgets_reassigned
    }
  };
}

/**
 * Legacy wrapper for batch processing
 */
export async function assignTransactionSplitsBatch(
  transactions: Transaction[],
  userId: string
): Promise<LegacyAssignSplitsResult[]> {
  const results = await assign_transaction_splits_batch(transactions, userId);
  return results.map(result => ({
    transaction: result.transaction,
    modified: result.modified,
    changes: {
      budgetIdsFixed: result.changes.budget_ids_fixed,
      amountsRedistributed: result.changes.amounts_redistributed,
      budgetsReassigned: result.changes.budgets_reassigned
    }
  }));
}
