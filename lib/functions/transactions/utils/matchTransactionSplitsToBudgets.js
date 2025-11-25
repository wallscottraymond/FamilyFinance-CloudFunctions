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
        // Build budget lookup array
        const budgets = budgetsSnapshot.docs.map(doc => ({
            id: doc.id,
            name: doc.data().name || 'General',
            startDate: doc.data().startDate ? doc.data().startDate.toMillis() : null,
            endDate: doc.data().endDate ? doc.data().endDate.toMillis() : null,
            isOngoing: doc.data().isOngoing !== false // Default to ongoing if not specified
        }));
        // Process each transaction
        let matchedCount = 0;
        transactions.forEach(transaction => {
            const txnDate = transaction.transactionDate.toMillis();
            // Find budget that contains this transaction date
            let matchedBudget = null;
            for (const budget of budgets) {
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
            // Update all splits in the transaction with budget info
            if (matchedBudget) {
                transaction.splits = transaction.splits.map(split => (Object.assign(Object.assign({}, split), { budgetId: matchedBudget.id, updatedAt: firestore_1.Timestamp.now() })));
                matchedCount++;
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