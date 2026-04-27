"use strict";
/**
 * Handle Budget Period Pause/Resume
 *
 * When a budget period is paused (isActive = false):
 * 1. Reassign transaction splits to "Everything Else" budget
 * 2. Store original budgetId in split for restore
 * 3. Add allocation to Everything Else period
 *
 * When a budget period is resumed (isActive = true):
 * 1. Reclaim transaction splits that were originally from this budget
 * 2. Restore Everything Else allocation
 *
 * This only affects the specific budget period being toggled.
 */
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBudgetPeriodPauseResume = handleBudgetPeriodPauseResume;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Find the Everything Else budget for a user
 */
async function findEverythingElseBudget(db, userId) {
    const query = await db.collection('budgets')
        .where('userId', '==', userId)
        .where('isSystemEverythingElse', '==', true)
        .limit(1)
        .get();
    return query.empty ? null : query.docs[0];
}
/**
 * Find corresponding Everything Else period for the same source period
 */
async function findCorrespondingEverythingElsePeriod(db, everythingElseBudgetId, sourcePeriodId) {
    const query = await db.collection('budget_periods')
        .where('budgetId', '==', everythingElseBudgetId)
        .where('sourcePeriodId', '==', sourcePeriodId)
        .limit(1)
        .get();
    return query.empty ? null : query.docs[0];
}
/**
 * Find transactions with splits assigned to this budget that fall within the period
 */
async function findTransactionsForBudgetPeriod(db, budgetId, periodStart, periodEnd, userId) {
    // Query transactions by user and date range
    const query = await db.collection('transactions')
        .where('userId', '==', userId)
        .where('date', '>=', firestore_1.Timestamp.fromDate(periodStart))
        .where('date', '<=', firestore_1.Timestamp.fromDate(periodEnd))
        .get();
    // Filter to only those with splits assigned to this budget
    return query.docs.filter(doc => {
        const data = doc.data();
        const splits = data.splits || [];
        return splits.some((split) => split.budgetId === budgetId);
    });
}
/**
 * Find transactions with splits that were paused from this budget
 */
async function findPausedTransactionsForBudgetPeriod(db, budgetId, periodStart, periodEnd, userId) {
    // Query transactions by user and date range
    const query = await db.collection('transactions')
        .where('userId', '==', userId)
        .where('date', '>=', firestore_1.Timestamp.fromDate(periodStart))
        .where('date', '<=', firestore_1.Timestamp.fromDate(periodEnd))
        .get();
    // Filter to only those with splits that have pausedFromBudgetId matching this budget
    return query.docs.filter(doc => {
        const data = doc.data();
        const splits = data.splits || [];
        return splits.some((split) => split.pausedFromBudgetId === budgetId);
    });
}
/**
 * Handle pause/resume for a specific budget period
 */
async function handleBudgetPeriodPauseResume(db, periodId, periodData, isPausing) {
    const result = {
        success: false,
        action: 'skipped',
        message: '',
        splitsReassigned: 0,
        amountRedistributed: 0,
        error: null
    };
    try {
        const budgetId = periodData.budgetId;
        const userId = periodData.userId || periodData.createdBy;
        const periodStart = periodData.periodStart.toDate();
        const periodEnd = periodData.periodEnd.toDate();
        const allocatedAmount = periodData.allocatedAmount || 0;
        console.log(`[handleBudgetPeriodPauseResume] ${isPausing ? 'Pausing' : 'Resuming'} period ${periodId}`);
        console.log(`[handleBudgetPeriodPauseResume] Budget: ${budgetId}, User: ${userId}`);
        console.log(`[handleBudgetPeriodPauseResume] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);
        // Find Everything Else budget
        const everythingElseBudget = await findEverythingElseBudget(db, userId);
        if (!everythingElseBudget) {
            result.error = 'Everything Else budget not found';
            console.error(`[handleBudgetPeriodPauseResume] ${result.error}`);
            return result;
        }
        const everythingElseBudgetId = everythingElseBudget.id;
        console.log(`[handleBudgetPeriodPauseResume] Found Everything Else budget: ${everythingElseBudgetId}`);
        // Find corresponding Everything Else period
        const everythingElsePeriod = await findCorrespondingEverythingElsePeriod(db, everythingElseBudgetId, periodData.sourcePeriodId);
        if (!everythingElsePeriod) {
            result.error = 'Corresponding Everything Else period not found';
            console.error(`[handleBudgetPeriodPauseResume] ${result.error}`);
            return result;
        }
        console.log(`[handleBudgetPeriodPauseResume] Found Everything Else period: ${everythingElsePeriod.id}`);
        if (isPausing) {
            // PAUSING: Reassign splits to Everything Else
            const transactions = await findTransactionsForBudgetPeriod(db, budgetId, periodStart, periodEnd, userId);
            console.log(`[handleBudgetPeriodPauseResume] Found ${transactions.length} transactions with splits to reassign`);
            let totalAmountReassigned = 0;
            let splitsCount = 0;
            // Use batched writes for efficiency
            const batch = db.batch();
            for (const txnDoc of transactions) {
                const txnData = txnDoc.data();
                const splits = txnData.splits || [];
                let modified = false;
                const newSplits = splits.map((split) => {
                    if (split.budgetId === budgetId) {
                        totalAmountReassigned += split.amount || 0;
                        splitsCount++;
                        modified = true;
                        return Object.assign(Object.assign({}, split), { budgetId: everythingElseBudgetId, pausedFromBudgetId: budgetId, pausedAt: firestore_1.Timestamp.now() });
                    }
                    return split;
                });
                if (modified) {
                    batch.update(txnDoc.ref, {
                        splits: newSplits,
                        updatedAt: firestore_1.Timestamp.now()
                    });
                }
            }
            // Update budget periods - store paused amounts for restore
            const periodRef = db.collection('budget_periods').doc(periodId);
            batch.update(periodRef, {
                pausedSpent: periodData.spent || 0,
                pausedAllocatedAmount: allocatedAmount,
                updatedAt: firestore_1.Timestamp.now()
            });
            // Update Everything Else period allocation
            batch.update(everythingElsePeriod.ref, {
                allocatedAmount: firestore_1.FieldValue.increment(allocatedAmount),
                remaining: firestore_1.FieldValue.increment(allocatedAmount - totalAmountReassigned),
                spent: firestore_1.FieldValue.increment(totalAmountReassigned),
                updatedAt: firestore_1.Timestamp.now()
            });
            await batch.commit();
            result.success = true;
            result.action = 'paused';
            result.splitsReassigned = splitsCount;
            result.amountRedistributed = totalAmountReassigned;
            result.message = `Reassigned ${splitsCount} splits ($${totalAmountReassigned.toFixed(2)}) to Everything Else`;
        }
        else {
            // RESUMING: Reclaim splits from Everything Else
            const transactions = await findPausedTransactionsForBudgetPeriod(db, budgetId, periodStart, periodEnd, userId);
            console.log(`[handleBudgetPeriodPauseResume] Found ${transactions.length} transactions with paused splits to reclaim`);
            let totalAmountReclaimed = 0;
            let splitsCount = 0;
            const batch = db.batch();
            for (const txnDoc of transactions) {
                const txnData = txnDoc.data();
                const splits = txnData.splits || [];
                let modified = false;
                const newSplits = splits.map((split) => {
                    if (split.pausedFromBudgetId === budgetId) {
                        totalAmountReclaimed += split.amount || 0;
                        splitsCount++;
                        modified = true;
                        // Remove pause tracking fields and restore original budgetId
                        const { pausedFromBudgetId, pausedAt } = split, rest = __rest(split, ["pausedFromBudgetId", "pausedAt"]);
                        return Object.assign(Object.assign({}, rest), { budgetId: budgetId // Restore original
                         });
                    }
                    return split;
                });
                if (modified) {
                    batch.update(txnDoc.ref, {
                        splits: newSplits,
                        updatedAt: firestore_1.Timestamp.now()
                    });
                }
            }
            // Get paused amounts from period (stored when paused)
            const periodRef = db.collection('budget_periods').doc(periodId);
            const pausedAllocated = periodData.pausedAllocatedAmount || allocatedAmount;
            // Clear paused fields from budget period
            batch.update(periodRef, {
                pausedSpent: firestore_1.FieldValue.delete(),
                pausedAllocatedAmount: firestore_1.FieldValue.delete(),
                updatedAt: firestore_1.Timestamp.now()
            });
            // Update Everything Else period - subtract the reclaimed amounts
            batch.update(everythingElsePeriod.ref, {
                allocatedAmount: firestore_1.FieldValue.increment(-pausedAllocated),
                remaining: firestore_1.FieldValue.increment(-(pausedAllocated - totalAmountReclaimed)),
                spent: firestore_1.FieldValue.increment(-totalAmountReclaimed),
                updatedAt: firestore_1.Timestamp.now()
            });
            await batch.commit();
            result.success = true;
            result.action = 'resumed';
            result.splitsReassigned = splitsCount;
            result.amountRedistributed = totalAmountReclaimed;
            result.message = `Reclaimed ${splitsCount} splits ($${totalAmountReclaimed.toFixed(2)}) from Everything Else`;
        }
        console.log(`[handleBudgetPeriodPauseResume] ✓ ${result.message}`);
    }
    catch (error) {
        console.error('[handleBudgetPeriodPauseResume] Error:', error);
        result.error = error.message || 'Unknown error';
    }
    return result;
}
//# sourceMappingURL=handleBudgetPeriodPauseResume.js.map