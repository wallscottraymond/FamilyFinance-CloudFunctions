"use strict";
/**
 * Transaction Reassignment Utility
 *
 * Reassigns transactions when budget categories change.
 * Queries all transactions assigned to a budget and reassigns them based on current rules.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reassignTransactionsForBudget = reassignTransactionsForBudget;
exports.reassignAllTransactions = reassignAllTransactions;
const firestore_1 = require("firebase-admin/firestore");
const matchTransactionSplitsToBudgets_1 = require("../../transactions/utils/matchTransactionSplitsToBudgets");
const db = (0, firestore_1.getFirestore)();
const MAX_BATCH_SIZE = 500; // Firestore batch write limit
/**
 * Reassign all transactions for a specific budget
 *
 * Used when budget categories change - finds all transactions assigned to the budget
 * and reassigns them based on current category matching rules.
 *
 * @param budgetId - Budget ID whose transactions need reassignment
 * @param userId - User ID for querying user-specific transactions
 * @returns Count of transactions reassigned
 */
async function reassignTransactionsForBudget(budgetId, userId) {
    console.log(`[reassignTransactions] Starting reassignment for budget: ${budgetId}, user: ${userId}`);
    try {
        // Step 1: Find all transactions with splits assigned to this budget
        // Note: This query requires a composite index on (ownerId, splits.budgetId)
        const transactionsSnapshot = await db.collection('transactions')
            .where('ownerId', '==', userId)
            .where('isActive', '==', true)
            .get();
        if (transactionsSnapshot.empty) {
            console.log('[reassignTransactions] No transactions found for user');
            return 0;
        }
        console.log(`[reassignTransactions] Found ${transactionsSnapshot.size} transactions to check`);
        // Step 2: Filter transactions that have splits assigned to this budget
        const affectedTransactions = [];
        transactionsSnapshot.docs.forEach(doc => {
            var _a;
            const transaction = Object.assign({ id: doc.id }, doc.data());
            const hasAffectedSplit = (_a = transaction.splits) === null || _a === void 0 ? void 0 : _a.some(split => split.budgetId === budgetId);
            if (hasAffectedSplit) {
                affectedTransactions.push(transaction);
            }
        });
        if (affectedTransactions.length === 0) {
            console.log(`[reassignTransactions] No transactions assigned to budget ${budgetId}`);
            return 0;
        }
        console.log(`[reassignTransactions] Found ${affectedTransactions.length} transactions assigned to budget ${budgetId}`);
        // Step 3: Reassign all affected transactions
        const reassignedTransactions = await (0, matchTransactionSplitsToBudgets_1.matchTransactionSplitsToBudgets)(affectedTransactions, userId);
        // Step 4: Update transactions in batches (Firestore limit: 500 per batch)
        let reassignedCount = 0;
        const batches = [];
        let currentBatch = db.batch();
        let operationsInBatch = 0;
        for (const transaction of reassignedTransactions) {
            if (operationsInBatch >= MAX_BATCH_SIZE) {
                batches.push(currentBatch);
                currentBatch = db.batch();
                operationsInBatch = 0;
            }
            const transactionRef = db.collection('transactions').doc(transaction.id);
            currentBatch.update(transactionRef, {
                splits: transaction.splits,
                updatedAt: new Date()
            });
            operationsInBatch++;
            reassignedCount++;
        }
        // Add the last batch if it has operations
        if (operationsInBatch > 0) {
            batches.push(currentBatch);
        }
        // Step 5: Commit all batches sequentially
        for (let i = 0; i < batches.length; i++) {
            await batches[i].commit();
            console.log(`[reassignTransactions] Committed batch ${i + 1}/${batches.length} (${Math.min((i + 1) * MAX_BATCH_SIZE, reassignedCount)} transactions)`);
        }
        console.log(`[reassignTransactions] Successfully reassigned ${reassignedCount} transactions`);
        return reassignedCount;
    }
    catch (error) {
        console.error('[reassignTransactions] Error reassigning transactions:', error);
        throw error;
    }
}
/**
 * Reassign all transactions for all budgets (useful for bulk operations)
 *
 * @param userId - User ID
 * @returns Total count of transactions reassigned
 */
async function reassignAllTransactions(userId) {
    console.log(`[reassignAllTransactions] Starting full reassignment for user: ${userId}`);
    try {
        // Get all active budgets for user
        const budgetsSnapshot = await db.collection('budgets')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .get();
        console.log(`[reassignAllTransactions] Found ${budgetsSnapshot.size} active budgets`);
        let totalReassigned = 0;
        for (const budgetDoc of budgetsSnapshot.docs) {
            const count = await reassignTransactionsForBudget(budgetDoc.id, userId);
            totalReassigned += count;
        }
        console.log(`[reassignAllTransactions] Total transactions reassigned: ${totalReassigned}`);
        return totalReassigned;
    }
    catch (error) {
        console.error('[reassignAllTransactions] Error in full reassignment:', error);
        throw error;
    }
}
//# sourceMappingURL=reassignTransactions.js.map