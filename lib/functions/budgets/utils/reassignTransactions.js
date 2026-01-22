"use strict";
/**
 * Transaction Reassignment Utility
 *
 * Reassigns transactions when budget categories change.
 * - Category Additions: Picks up unassigned transactions matching new categories
 * - Category Removals: Re-evaluates ALL splits in affected transactions (not just removed category)
 *
 * Key Features:
 * - Full transaction re-evaluation on category removal (user requirement)
 * - Batch processing (respects 500-doc Firestore limit)
 * - Comprehensive logging and statistics
 *
 * Called by: onBudgetUpdate trigger when categoryIds change
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reassignTransactionsForBudget = reassignTransactionsForBudget;
exports.reassignAllTransactions = reassignAllTransactions;
const firestore_1 = require("firebase-admin/firestore");
const matchTransactionSplitsToBudgets_1 = require("../../transactions/utils/matchTransactionSplitsToBudgets");
const db = (0, firestore_1.getFirestore)();
const MAX_BATCH_SIZE = 500; // Firestore batch write limit
/**
 * Reassign transactions when budget categories change (ENHANCED VERSION)
 *
 * This function handles two scenarios:
 * 1. Category Additions: Picks up transactions with unassigned splits matching new categories
 * 2. Category Removals: Re-evaluates ALL splits in affected transactions (not just removed category)
 *
 * @param budgetId - Budget ID whose transactions need reassignment
 * @param userId - User ID for querying user-specific transactions
 * @param changes - Categories added/removed
 * @returns Reassignment statistics
 */
async function reassignTransactionsForBudget(budgetId, userId, changes) {
    var _a;
    // If no changes provided, use legacy behavior
    if (!changes) {
        return reassignTransactionsForBudgetLegacy(budgetId, userId);
    }
    console.log(`[reassignTransactionsForBudget] Enhanced mode - budget: ${budgetId}, user: ${userId}`);
    console.log(`[reassignTransactionsForBudget] Changes:`, changes);
    const stats = {
        success: true,
        transactionsReassigned: 0,
        splitsReassigned: 0,
        errors: []
    };
    try {
        // Get all active budgets for matching
        const activeBudgetsSnapshot = await db.collection('budgets')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .get();
        const allActiveBudgets = [];
        let everythingElseBudget = null;
        activeBudgetsSnapshot.forEach(doc => {
            const budget = {
                id: doc.id,
                startDate: doc.data().startDate,
                endDate: doc.data().endDate,
                budgetEndDate: doc.data().budgetEndDate,
                isOngoing: doc.data().isOngoing,
                categoryIds: doc.data().categoryIds || [],
                isSystemEverythingElse: doc.data().isSystemEverythingElse || false
            };
            if (budget.isSystemEverythingElse) {
                everythingElseBudget = budget;
            }
            else {
                allActiveBudgets.push(budget);
            }
        });
        console.log(`[reassignTransactionsForBudget] Found ${allActiveBudgets.length} active budgets`);
        // Determine which transactions to process
        let transactionsToProcess = [];
        // CATEGORY REMOVALS: Re-evaluate ALL splits in affected transactions
        if (changes.categoriesRemoved.length > 0) {
            console.log(`[reassignTransactionsForBudget] Processing ${changes.categoriesRemoved.length} category removals - will re-evaluate ALL splits`);
            const transactionsQuery = db.collection('transactions')
                .where('ownerId', '==', userId)
                .where('isActive', '==', true);
            const allTransactions = await transactionsQuery.get();
            // Filter to transactions with at least one split assigned to this budget
            transactionsToProcess = allTransactions.docs.filter(doc => {
                const data = doc.data();
                if (!data.splits || !Array.isArray(data.splits))
                    return false;
                return data.splits.some((split) => split.budgetId === budgetId);
            });
            console.log(`[reassignTransactionsForBudget] Found ${transactionsToProcess.length} transactions to re-evaluate`);
        }
        // CATEGORY ADDITIONS: Pick up unassigned transactions
        if (changes.categoriesAdded.length > 0) {
            console.log(`[reassignTransactionsForBudget] Processing ${changes.categoriesAdded.length} category additions`);
            const transactionsQuery = db.collection('transactions')
                .where('ownerId', '==', userId)
                .where('isActive', '==', true);
            const allTransactions = await transactionsQuery.get();
            // Filter to transactions with unassigned splits matching new categories
            const unassignedTransactions = allTransactions.docs.filter(doc => {
                const data = doc.data();
                if (!data.splits || !Array.isArray(data.splits))
                    return false;
                return data.splits.some((split) => {
                    const isUnassigned = split.budgetId === 'unassigned' ||
                        split.budgetId === (everythingElseBudget === null || everythingElseBudget === void 0 ? void 0 : everythingElseBudget.id);
                    if (!isUnassigned)
                        return false;
                    // Check if split category matches any of the added categories
                    const splitCategory = split.internalPrimaryCategory || split.plaidPrimaryCategory;
                    return changes.categoriesAdded.some(addedCat => splitCategory === null || splitCategory === void 0 ? void 0 : splitCategory.toLowerCase().includes(addedCat.toLowerCase()));
                });
            });
            // Merge with existing list (avoid duplicates)
            const existingIds = new Set(transactionsToProcess.map(doc => doc.id));
            unassignedTransactions.forEach(doc => {
                if (!existingIds.has(doc.id)) {
                    transactionsToProcess.push(doc);
                }
            });
            console.log(`[reassignTransactionsForBudget] Added ${unassignedTransactions.length} unassigned transactions`);
        }
        if (transactionsToProcess.length === 0) {
            console.log(`[reassignTransactionsForBudget] No transactions to process`);
            return stats;
        }
        // Process transactions in batches
        const batches = [];
        for (let i = 0; i < transactionsToProcess.length; i += MAX_BATCH_SIZE) {
            batches.push(transactionsToProcess.slice(i, i + MAX_BATCH_SIZE));
        }
        for (const batch of batches) {
            const firestoreBatch = db.batch();
            for (const txnDoc of batch) {
                try {
                    const txnData = txnDoc.data();
                    const transactionDate = (_a = txnData.transactionDate) === null || _a === void 0 ? void 0 : _a.toDate();
                    if (!transactionDate) {
                        stats.errors.push(`Transaction ${txnDoc.id}: Missing transactionDate`);
                        continue;
                    }
                    // Re-evaluate ALL splits
                    let splitsChanged = false;
                    const updatedSplits = txnData.splits.map((split) => {
                        // Find best matching budget for this split
                        let matchedBudget = null;
                        // Try regular budgets first (date-based matching)
                        for (const budget of allActiveBudgets) {
                            const isAfterStart = transactionDate >= budget.startDate.toDate();
                            let isWithinRange = false;
                            if (budget.isOngoing) {
                                isWithinRange = isAfterStart;
                            }
                            else {
                                const budgetEnd = budget.budgetEndDate || budget.endDate;
                                isWithinRange = isAfterStart && budgetEnd && (transactionDate <= budgetEnd.toDate());
                            }
                            if (isWithinRange) {
                                matchedBudget = budget;
                                break;
                            }
                        }
                        // Fallback to "Everything Else" budget
                        if (!matchedBudget && everythingElseBudget) {
                            matchedBudget = everythingElseBudget;
                        }
                        const newBudgetId = matchedBudget ? matchedBudget.id : 'unassigned';
                        if (split.budgetId !== newBudgetId) {
                            splitsChanged = true;
                            stats.splitsReassigned++;
                        }
                        return Object.assign(Object.assign({}, split), { budgetId: newBudgetId, updatedAt: firestore_1.Timestamp.now() });
                    });
                    if (splitsChanged) {
                        firestoreBatch.update(txnDoc.ref, {
                            splits: updatedSplits,
                            updatedAt: firestore_1.Timestamp.now()
                        });
                        stats.transactionsReassigned++;
                    }
                }
                catch (error) {
                    stats.errors.push(`Transaction ${txnDoc.id}: ${error.message}`);
                }
            }
            await firestoreBatch.commit();
            console.log(`[reassignTransactionsForBudget] Committed batch ${batches.indexOf(batch) + 1}/${batches.length}`);
        }
        console.log(`[reassignTransactionsForBudget] Completed: ${stats.transactionsReassigned} transactions, ${stats.splitsReassigned} splits reassigned`);
        return stats;
    }
    catch (error) {
        console.error(`[reassignTransactionsForBudget] Error:`, error);
        stats.errors.push(error.message);
        return stats;
    }
}
/**
 * LEGACY VERSION: Reassign all transactions for a specific budget
 *
 * @param budgetId - Budget ID whose transactions need reassignment
 * @param userId - User ID for querying user-specific transactions
 * @returns Count of transactions reassigned
 */
async function reassignTransactionsForBudgetLegacy(budgetId, userId) {
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
            totalReassigned += typeof count === 'number' ? count : count.transactionsReassigned;
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