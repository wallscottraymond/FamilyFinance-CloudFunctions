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
 *
 * @module transactions/utils/match_transaction_splits_to_budgets
 */

import { Timestamp, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../../../index';
import { Transaction as FamilyTransaction, TransactionSplit } from '../../../types';

/**
 * Budget object for matching operations
 */
interface BudgetMatch {
  id: string;
  name: string;
  start_date: number | null;
  end_date: number | null;
  is_ongoing: boolean;
  category_ids: string[];
  is_system_everything_else: boolean;
}

/**
 * Check if a transaction split's category matches a budget's allowed categories
 *
 * @param split - Transaction split with category information
 * @param budget - Budget with category_ids array
 * @returns true if category matches
 */
function does_category_match(
  split: Pick<TransactionSplit, 'plaidPrimaryCategory' | 'internalPrimaryCategory'>,
  budget: Pick<BudgetMatch, 'category_ids'>
): boolean {
  // Budget with no categories configured = no match
  if (!budget.category_ids || budget.category_ids.length === 0) {
    return false;
  }

  // Determine which category to match against (prioritize user override)
  const category_to_match = split.internalPrimaryCategory || split.plaidPrimaryCategory;

  // No category available on transaction - no match
  if (!category_to_match) {
    return false;
  }

  // Check if budget's categories include this transaction's category
  return budget.category_ids.includes(category_to_match);
}

/**
 * Match transaction splits to budgets based on transaction dates AND categories (in-memory)
 *
 * Queries budgets by date range and updates each transaction's splits
 * with matching budgetId and budgetName fields.
 *
 * @param transactions - Array of transactions to match
 * @param user_id - User ID for querying user-specific budgets
 * @returns Modified array of transactions with budget info populated in splits
 */
export async function match_transaction_splits_to_budgets(
  transactions: FamilyTransaction[],
  user_id: string
): Promise<FamilyTransaction[]> {
  console.log(`💰 [match_transaction_splits_to_budgets] Matching ${transactions.length} transaction splits to budgets`);

  if (transactions.length === 0) {
    return transactions;
  }

  try {
    // Query all active budgets for the user
    // Try both 'createdBy' (new RBAC field) and 'userId' (legacy field) for backward compatibility
    const [created_by_snapshot, user_id_snapshot] = await Promise.all([
      db.collection('budgets')
        .where('createdBy', '==', user_id)
        .where('isActive', '==', true)
        .get(),
      db.collection('budgets')
        .where('userId', '==', user_id)
        .where('isActive', '==', true)
        .get()
    ]);

    // Merge results, deduplicating by document ID
    const budget_docs = new Map<string, QueryDocumentSnapshot>();
    created_by_snapshot.docs.forEach(doc => budget_docs.set(doc.id, doc));
    user_id_snapshot.docs.forEach(doc => budget_docs.set(doc.id, doc));

    console.log(`💰 [match_transaction_splits_to_budgets] Found ${budget_docs.size} active budgets for user`);

    // Build budget list - all budgets treated equally
    const budgets: BudgetMatch[] = [];

    budget_docs.forEach((doc) => {
      const budget_data = doc.data();
      budgets.push({
        id: doc.id,
        name: budget_data.name || 'General',
        start_date: budget_data.startDate ? (budget_data.startDate as Timestamp).toMillis() : null,
        end_date: budget_data.endDate ? (budget_data.endDate as Timestamp).toMillis() : null,
        is_ongoing: budget_data.isOngoing !== false, // Default to ongoing if not specified
        category_ids: budget_data.categoryIds || [],
        is_system_everything_else: budget_data.isSystemEverythingElse === true
      });
    });

    // Log budget info for debugging
    if (budgets.length > 0) {
      console.log(`💰 [match_transaction_splits_to_budgets] Budget categories:`, budgets.map(b => ({
        name: b.name,
        category_count: b.category_ids.length,
        is_everything_else: b.is_system_everything_else
      })));
    }

    // Process each transaction
    let matched_count = 0;
    let split_matched_count = 0;
    let everything_else_count = 0;

    transactions.forEach(transaction => {
      const txn_date = transaction.transactionDate.toMillis();
      let transaction_has_match = false;

      // Process EACH SPLIT independently (each split can have different category)
      transaction.splits = transaction.splits.map(split => {
        let matched_budget: BudgetMatch | null = null;

        // Find first budget that matches BOTH date range AND category
        for (const budget of budgets) {
          if (!budget.start_date) continue;

          // Date range check
          const is_after_start = txn_date >= budget.start_date;
          let is_within_date_range = is_after_start;
          if (!budget.is_ongoing && budget.end_date) {
            const is_before_end = txn_date <= budget.end_date;
            is_within_date_range = is_after_start && is_before_end;
          }

          // Skip if date doesn't match
          if (!is_within_date_range) continue;

          // Category check - ALL budgets match by category now
          const category_matches = does_category_match(split, budget);

          // BOTH date AND category must match
          if (category_matches) {
            matched_budget = budget;
            if (budget.is_system_everything_else) {
              everything_else_count++;
            }
            break; // Use first matching budget
          }
        }

        // Update split with budget info
        if (matched_budget) {
          transaction_has_match = true;
          split_matched_count++;
          console.log(`💰 [match_transaction_splits_to_budgets] Split matched to "${matched_budget.name}" (category: ${split.internalPrimaryCategory || split.plaidPrimaryCategory})`);
          return {
            ...split,
            budgetId: matched_budget.id,
            budgetName: matched_budget.name,
            updatedAt: Timestamp.now()
          };
        } else {
          // No match found - remains 'unassigned' (shouldn't happen if Everything Else has all categories)
          console.warn(`💰 [match_transaction_splits_to_budgets] Split has no matching budget (category: ${split.internalPrimaryCategory || split.plaidPrimaryCategory})`);
          return split;
        }
      });

      if (transaction_has_match) {
        matched_count++;
      }
    });

    console.log(`💰 [match_transaction_splits_to_budgets] Results: ${matched_count}/${transactions.length} transactions matched, ${split_matched_count} splits assigned (${everything_else_count} to "Everything Else")`);

    return transactions;

  } catch (error) {
    console.error('[match_transaction_splits_to_budgets] Error matching splits to budgets:', error);
    return transactions; // Return original array on error
  }
}

// Legacy export for backward compatibility
export { match_transaction_splits_to_budgets as matchTransactionSplitsToBudgets };
