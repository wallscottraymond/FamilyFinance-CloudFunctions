"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchTransactionSplitsToBudgets = matchTransactionSplitsToBudgets;
const firestore_1 = require("firebase-admin/firestore");
const index_1 = require("../../../index");
/**
 * Check if a transaction split's category matches a budget's allowed categories
 *
 * @param split - Transaction split with category information
 * @param budget - Budget with categoryIds array
 * @returns true if category matches or budget accepts all categories
 */
function doesCategoryMatch(split, budget) {
    // "Everything Else" budget accepts all categories
    if (budget.isSystemEverythingElse) {
        return true;
    }
    // Regular budget with no categories configured = no match
    // (User hasn't set up category filtering for this budget)
    if (!budget.categoryIds || budget.categoryIds.length === 0) {
        return false;
    }
    // Determine which category to match against (prioritize user override)
    const categoryToMatch = split.internalPrimaryCategory || split.plaidPrimaryCategory;
    // No category available on transaction - no match to category-specific budget
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
async function matchTransactionSplitsToBudgets(transactions, userId) {
    console.log(`💰 [matchTransactionSplitsToBudgets] Matching ${transactions.length} transaction splits to budgets`);
    if (transactions.length === 0) {
        return transactions;
    }
    try {
        // Query all active budgets for the user
        const budgetsSnapshot = await index_1.db.collection('budgets')
            .where('createdBy', '==', userId)
            .where('isActive', '==', true)
            .get();
        console.log(`💰 [matchTransactionSplitsToBudgets] Found ${budgetsSnapshot.size} active budgets for user`);
        // Separate "everything else" system budget from regular budgets
        const regularBudgets = [];
        let everythingElseBudget = null;
        budgetsSnapshot.docs.forEach(doc => {
            const budgetData = doc.data();
            const budget = {
                id: doc.id,
                name: budgetData.name || 'General',
                startDate: budgetData.startDate ? budgetData.startDate.toMillis() : null,
                endDate: budgetData.endDate ? budgetData.endDate.toMillis() : null,
                isOngoing: budgetData.isOngoing !== false, // Default to ongoing if not specified
                categoryIds: budgetData.categoryIds || [],
                isSystemEverythingElse: budgetData.isSystemEverythingElse === true
            };
            // Separate system "everything else" budget from regular budgets
            if (budget.isSystemEverythingElse) {
                everythingElseBudget = budget;
            }
            else {
                regularBudgets.push(budget);
            }
        });
        console.log(`💰 [matchTransactionSplitsToBudgets] Regular budgets: ${regularBudgets.length}, Everything else budget: ${everythingElseBudget ? 'Yes' : 'No'}`);
        // Log category info for regular budgets (for debugging)
        if (regularBudgets.length > 0) {
            console.log(`💰 [matchTransactionSplitsToBudgets] Budget categories:`, regularBudgets.map(b => ({
                name: b.name,
                categoryIds: b.categoryIds
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
                // Step 1: Try regular budgets first (DATE + CATEGORY matching)
                let matchedBudget = null;
                for (const budget of regularBudgets) {
                    if (!budget.startDate)
                        continue;
                    // Date range check
                    const isAfterStart = txnDate >= budget.startDate;
                    let isWithinDateRange = isAfterStart;
                    if (!budget.isOngoing && budget.endDate) {
                        const isBeforeEnd = txnDate <= budget.endDate;
                        isWithinDateRange = isAfterStart && isBeforeEnd;
                    }
                    // Skip if date doesn't match
                    if (!isWithinDateRange)
                        continue;
                    // Category check
                    const categoryMatches = doesCategoryMatch(split, budget);
                    // BOTH date AND category must match for regular budgets
                    if (categoryMatches) {
                        matchedBudget = budget;
                        console.log(`💰 [matchTransactionSplitsToBudgets] Split matched to "${budget.name}" (date + category: ${split.internalPrimaryCategory || split.plaidPrimaryCategory})`);
                        break; // Use first matching budget
                    }
                }
                // Step 2: Fallback to "everything else" budget if no regular budget matched
                if (!matchedBudget && everythingElseBudget) {
                    // Check if "everything else" budget is within date range
                    const isAfterStart = !everythingElseBudget.startDate || txnDate >= everythingElseBudget.startDate;
                    let isWithinDateRange = isAfterStart;
                    if (!everythingElseBudget.isOngoing && everythingElseBudget.endDate) {
                        isWithinDateRange = isAfterStart && txnDate <= everythingElseBudget.endDate;
                    }
                    if (isWithinDateRange) {
                        matchedBudget = everythingElseBudget;
                        everythingElseCount++;
                        console.log(`💰 [matchTransactionSplitsToBudgets] Split assigned to "Everything Else" budget (category: ${split.internalPrimaryCategory || split.plaidPrimaryCategory})`);
                    }
                }
                // Step 3: Update split with budget info
                if (matchedBudget) {
                    transactionHasMatch = true;
                    splitMatchedCount++;
                    return Object.assign(Object.assign({}, split), { budgetId: matchedBudget.id, budgetName: matchedBudget.name, updatedAt: firestore_1.Timestamp.now() });
                }
                else {
                    // No match found - remains 'unassigned' (graceful degradation)
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
    }
    catch (error) {
        console.error('[matchTransactionSplitsToBudgets] Error matching splits to budgets:', error);
        return transactions; // Return original array on error
    }
}
//# sourceMappingURL=matchTransactionSplitsToBudgets.js.map