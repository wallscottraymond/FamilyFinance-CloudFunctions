"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reassignTransactionsFromDeletedBudget = reassignTransactionsFromDeletedBudget;
const firestore_1 = require("firebase-admin/firestore");
const BATCH_LIMIT = 500;
/**
 * Reassign all transactions from deleted budget to active budgets
 *
 * @param deletedBudgetId - ID of the deleted budget
 * @param userId - User ID (owner of transactions)
 * @returns Reassignment statistics and errors
 */
async function reassignTransactionsFromDeletedBudget(deletedBudgetId, userId) {
    var _a;
    const db = (0, firestore_1.getFirestore)();
    console.log(`[reassignTransactionsFromDeletedBudget] Starting reassignment for budget: ${deletedBudgetId}, user: ${userId}`);
    try {
        // Step 1: Verify budget exists and is deleted
        const budgetRef = db.collection('budgets').doc(deletedBudgetId);
        const budgetSnap = await budgetRef.get();
        if (!budgetSnap.exists) {
            return {
                success: false,
                transactionsReassigned: 0,
                budgetAssignments: {},
                batchCount: 0,
                errors: [],
                error: 'Budget not found'
            };
        }
        const budgetData = budgetSnap.data();
        if ((budgetData === null || budgetData === void 0 ? void 0 : budgetData.isActive) !== false) {
            return {
                success: false,
                transactionsReassigned: 0,
                budgetAssignments: {},
                batchCount: 0,
                errors: [],
                error: 'Budget is not deleted (isActive must be false)'
            };
        }
        // Step 2: Query all transactions with splits assigned to deleted budget
        // Note: This requires a composite index on (ownerId, isActive)
        const transactionsQuery = db.collection('transactions')
            .where('ownerId', '==', userId)
            .where('isActive', '==', true);
        const transactionsSnapshot = await transactionsQuery.get();
        console.log(`[reassignTransactionsFromDeletedBudget] Found ${transactionsSnapshot.size} total transactions for user`);
        // Filter to only transactions with splits assigned to deleted budget
        const affectedTransactions = transactionsSnapshot.docs.filter(doc => {
            const data = doc.data();
            if (!data.splits || !Array.isArray(data.splits)) {
                return false;
            }
            return data.splits.some((split) => split.budgetId === deletedBudgetId);
        });
        console.log(`[reassignTransactionsFromDeletedBudget] Found ${affectedTransactions.length} transactions with splits assigned to deleted budget`);
        if (affectedTransactions.length === 0) {
            return {
                success: true,
                transactionsReassigned: 0,
                budgetAssignments: {},
                batchCount: 0,
                errors: []
            };
        }
        // Step 3: Query active budgets for matching (excluding deleted budget)
        const activeBudgetsQuery = db.collection('budgets')
            .where('userId', '==', userId)
            .where('isActive', '==', true);
        const activeBudgetsSnapshot = await activeBudgetsQuery.get();
        // Separate "Everything Else" budget from regular budgets
        const regularBudgets = [];
        let everythingElseBudget = null;
        activeBudgetsSnapshot.forEach(doc => {
            const budgetData = doc.data();
            const budgetObj = {
                id: doc.id,
                startDate: budgetData.startDate,
                endDate: budgetData.endDate,
                budgetEndDate: budgetData.budgetEndDate,
                isOngoing: budgetData.isOngoing,
                categoryIds: budgetData.categoryIds || [],
                isSystemEverythingElse: budgetData.isSystemEverythingElse || false
            };
            if (budgetObj.isSystemEverythingElse) {
                everythingElseBudget = budgetObj;
            }
            else {
                regularBudgets.push(budgetObj);
            }
        });
        console.log(`[reassignTransactionsFromDeletedBudget] Found ${regularBudgets.length} regular budgets, everythingElse: ${everythingElseBudget ? 'yes' : 'no'}`);
        // Step 4: Process transactions and update splits
        const budgetAssignments = {};
        const errors = [];
        let transactionsReassigned = 0;
        let batchCount = 0;
        // Split into batches (500-doc limit)
        const batches = [];
        for (let i = 0; i < affectedTransactions.length; i += BATCH_LIMIT) {
            batches.push(affectedTransactions.slice(i, i + BATCH_LIMIT));
        }
        batchCount = batches.length;
        for (const batch of batches) {
            const firestoreBatch = db.batch();
            for (const txnDoc of batch) {
                try {
                    const txnData = txnDoc.data();
                    const transactionDate = (_a = txnData.transactionDate) === null || _a === void 0 ? void 0 : _a.toDate();
                    if (!transactionDate) {
                        errors.push(`Transaction ${txnDoc.id}: Missing transactionDate`);
                        continue;
                    }
                    // Update splits assigned to deleted budget
                    const updatedSplits = txnData.splits.map((split) => {
                        if (split.budgetId !== deletedBudgetId) {
                            return split; // Keep other splits unchanged
                        }
                        // Find matching budget for this split
                        let matchedBudget = null;
                        // Try regular budgets first
                        for (const budget of regularBudgets) {
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
                                break; // First match wins
                            }
                        }
                        // Fallback to "Everything Else" budget
                        if (!matchedBudget && everythingElseBudget) {
                            matchedBudget = everythingElseBudget;
                        }
                        // Determine final budget ID
                        const newBudgetId = matchedBudget ? matchedBudget.id : 'unassigned';
                        // Track assignments
                        budgetAssignments[newBudgetId] = (budgetAssignments[newBudgetId] || 0) + 1;
                        return Object.assign(Object.assign({}, split), { budgetId: newBudgetId, updatedAt: firestore_1.Timestamp.now() });
                    });
                    // Update transaction in batch
                    firestoreBatch.update(txnDoc.ref, {
                        splits: updatedSplits,
                        updatedAt: firestore_1.Timestamp.now()
                    });
                    transactionsReassigned++;
                }
                catch (error) {
                    errors.push(`Transaction ${txnDoc.id}: ${error.message}`);
                }
            }
            // Commit batch
            await firestoreBatch.commit();
            console.log(`[reassignTransactionsFromDeletedBudget] Committed batch ${batches.indexOf(batch) + 1}/${batches.length}`);
        }
        // Step 5: Return statistics
        console.log(`[reassignTransactionsFromDeletedBudget] Completed: ${transactionsReassigned} transactions reassigned`);
        console.log(`[reassignTransactionsFromDeletedBudget] Budget assignments:`, budgetAssignments);
        return {
            success: true,
            transactionsReassigned,
            budgetAssignments,
            batchCount,
            errors
        };
    }
    catch (error) {
        console.error(`[reassignTransactionsFromDeletedBudget] Error:`, error);
        return {
            success: false,
            transactionsReassigned: 0,
            budgetAssignments: {},
            batchCount: 0,
            errors: [error.message],
            error: error.message
        };
    }
}
//# sourceMappingURL=reassignTransactionsFromDeletedBudget.js.map