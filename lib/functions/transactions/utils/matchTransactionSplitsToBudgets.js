"use strict";
/**
 * Transaction Splits to Budgets Matching Utility (In-Memory Processing)
 *
 * Matches transaction splits to budgets based on date range.
 * Operates in-memory on transaction arrays (no DB writes).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchTransactionSplitsToBudgets = matchTransactionSplitsToBudgets;
const firestore_1 = require("firebase-admin/firestore");
const index_1 = require("../../../index");
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
                isOngoing: budgetData.isOngoing !== false // Default to ongoing if not specified
            };
            // Separate system "everything else" budget from regular budgets
            if (budgetData.isSystemEverythingElse === true) {
                everythingElseBudget = budget;
            }
            else {
                regularBudgets.push(budget);
            }
        });
        console.log(`💰 [matchTransactionSplitsToBudgets] Regular budgets: ${regularBudgets.length}, Everything else budget: ${everythingElseBudget ? 'Yes' : 'No'}`);
        // Process each transaction
        let matchedCount = 0;
        transactions.forEach(transaction => {
            const txnDate = transaction.transactionDate.toMillis();
            // Step 1: Try regular budgets first
            let matchedBudget = null;
            for (const budget of regularBudgets) {
                if (!budget.startDate)
                    continue;
                const isAfterStart = txnDate >= budget.startDate;
                // For ongoing budgets, only check start date
                // For budgets with end dates, check both start and end
                let isWithinRange = isAfterStart;
                if (!budget.isOngoing && budget.endDate) {
                    const isBeforeEnd = txnDate <= budget.endDate;
                    isWithinRange = isAfterStart && isBeforeEnd;
                }
                if (isWithinRange) {
                    matchedBudget = budget;
                    break; // Use first matching budget
                }
            }
            // Step 2: Fallback to "everything else" budget if no regular budget matched
            if (!matchedBudget && everythingElseBudget) {
                matchedBudget = everythingElseBudget;
                console.log(`💰 [matchTransactionSplitsToBudgets] Transaction assigned to "everything else" budget (no regular budget match)`);
            }
            // Step 3: Update all splits in the transaction with budget info
            if (matchedBudget) {
                transaction.splits = transaction.splits.map(split => (Object.assign(Object.assign({}, split), { budgetId: matchedBudget.id, updatedAt: firestore_1.Timestamp.now() })));
                matchedCount++;
            }
            else {
                // No match found - remains 'unassigned' (graceful degradation)
                console.warn(`💰 [matchTransactionSplitsToBudgets] Transaction has no matching budget (no "everything else" budget found)`);
            }
        });
        console.log(`💰 [matchTransactionSplitsToBudgets] Successfully matched ${matchedCount} of ${transactions.length} transactions to budgets`);
        return transactions;
    }
    catch (error) {
        console.error('[matchTransactionSplitsToBudgets] Error matching splits to budgets:', error);
        return transactions; // Return original array on error
    }
}
//# sourceMappingURL=matchTransactionSplitsToBudgets.js.map