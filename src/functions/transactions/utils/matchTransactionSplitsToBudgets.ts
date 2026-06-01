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

import { Timestamp, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../../../index';
import { Transaction as FamilyTransaction, TransactionSplit } from '../../../types';

/**
 * Budget object for matching operations
 */
interface BudgetMatch {
  id: string;
  name: string;
  startDate: number | null;
  endDate: number | null;
  isOngoing: boolean;
  categoryIds: string[];
  isSystemEverythingElse: boolean;
}

/**
 * Check if a transaction split's category matches a budget's allowed categories
 *
 * @param split - Transaction split with category information
 * @param budget - Budget with categoryIds array
 * @returns true if category matches
 */
function doesCategoryMatch(
  split: Pick<TransactionSplit, 'plaidPrimaryCategory' | 'internalPrimaryCategory'>,
  budget: Pick<BudgetMatch, 'categoryIds'>
): boolean {
  // Budget with no categories configured = no match
  if (!budget.categoryIds || budget.categoryIds.length === 0) {
    return false;
  }

  // Determine which category to match against (prioritize user override)
  const categoryToMatch = split.internalPrimaryCategory || split.plaidPrimaryCategory;

  // No category available on transaction - no match
  if (!categoryToMatch) {
    return false;
  }

  // Check if budget's categories include this transaction's category
  return budget.categoryIds.includes(categoryToMatch);
}

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
export async function matchTransactionSplitsToBudgets(
  transactions: FamilyTransaction[],
  userId: string
): Promise<FamilyTransaction[]> {
  console.log(`💰 [matchTransactionSplitsToBudgets] Matching ${transactions.length} transaction splits to budgets`);

  if (transactions.length === 0) {
    return transactions;
  }

  try {
    // Query all active budgets for the user
    // Try both 'createdBy' (new RBAC field) and 'userId' (legacy field) for backward compatibility
    const [createdBySnapshot, userIdSnapshot] = await Promise.all([
      db.collection('budgets')
        .where('createdBy', '==', userId)
        .where('isActive', '==', true)
        .get(),
      db.collection('budgets')
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .get()
    ]);

    // Merge results, deduplicating by document ID
    const budgetDocs = new Map<string, QueryDocumentSnapshot>();
    createdBySnapshot.docs.forEach(doc => budgetDocs.set(doc.id, doc));
    userIdSnapshot.docs.forEach(doc => budgetDocs.set(doc.id, doc));

    console.log(`💰 [matchTransactionSplitsToBudgets] Found ${budgetDocs.size} active budgets for user`);

    // Build budget list - all budgets treated equally
    const budgets: BudgetMatch[] = [];

    budgetDocs.forEach((doc) => {
      const budgetData = doc.data();
      budgets.push({
        id: doc.id,
        name: budgetData.name || 'General',
        startDate: budgetData.startDate ? (budgetData.startDate as Timestamp).toMillis() : null,
        endDate: budgetData.endDate ? (budgetData.endDate as Timestamp).toMillis() : null,
        isOngoing: budgetData.isOngoing !== false, // Default to ongoing if not specified
        categoryIds: budgetData.categoryIds || [],
        isSystemEverythingElse: budgetData.isSystemEverythingElse === true
      });
    });

    // Log budget info for debugging
    if (budgets.length > 0) {
      console.log(`💰 [matchTransactionSplitsToBudgets] Budget categories:`, budgets.map(b => ({
        name: b.name,
        categoryCount: b.categoryIds.length,
        isEverythingElse: b.isSystemEverythingElse
      })));
    }

    // Process each transaction
    let matchedCount = 0;
    let splitMatchedCount = 0;
    let everythingElseCount = 0;

    transactions.forEach(transaction => {
      const txnDate = transaction.transactionDate.toMillis();
      let transactionHasMatch = false;

      // Process EACH SPLIT independently (each split can have different category)
      transaction.splits = transaction.splits.map(split => {
        let matchedBudget: BudgetMatch | null = null;

        // Find first budget that matches BOTH date range AND category
        for (const budget of budgets) {
          if (!budget.startDate) continue;

          // Date range check
          const isAfterStart = txnDate >= budget.startDate;
          let isWithinDateRange = isAfterStart;
          if (!budget.isOngoing && budget.endDate) {
            const isBeforeEnd = txnDate <= budget.endDate;
            isWithinDateRange = isAfterStart && isBeforeEnd;
          }

          // Skip if date doesn't match
          if (!isWithinDateRange) continue;

          // Category check - ALL budgets match by category now
          const categoryMatches = doesCategoryMatch(split, budget);

          // BOTH date AND category must match
          if (categoryMatches) {
            matchedBudget = budget;
            if (budget.isSystemEverythingElse) {
              everythingElseCount++;
            }
            break; // Use first matching budget
          }
        }

        // Update split with budget info
        if (matchedBudget) {
          transactionHasMatch = true;
          splitMatchedCount++;
          console.log(`💰 [matchTransactionSplitsToBudgets] Split matched to "${matchedBudget.name}" (category: ${split.internalPrimaryCategory || split.plaidPrimaryCategory})`);
          return {
            ...split,
            budgetId: matchedBudget.id,
            budgetName: matchedBudget.name,
            updatedAt: Timestamp.now()
          };
        } else {
          // No match found - remains 'unassigned' (shouldn't happen if Everything Else has all categories)
          console.warn(`💰 [matchTransactionSplitsToBudgets] Split has no matching budget (category: ${split.internalPrimaryCategory || split.plaidPrimaryCategory})`);
          return split;
        }
      });

      if (transactionHasMatch) {
        matchedCount++;
      }
    });

    console.log(`💰 [matchTransactionSplitsToBudgets] Results: ${matchedCount}/${transactions.length} transactions matched, ${splitMatchedCount} splits assigned (${everythingElseCount} to "Everything Else")`);

    return transactions;

  } catch (error) {
    console.error('[matchTransactionSplitsToBudgets] Error matching splits to budgets:', error);
    return transactions; // Return original array on error
  }
}
