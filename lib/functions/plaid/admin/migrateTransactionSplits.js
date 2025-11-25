"use strict";
/**
 * Admin utility to re-process existing Plaid transactions
 *
 * This function will re-run the category mapping and budget period matching
 * for existing transactions to apply fixes.
 *
 * USE WITH CAUTION - This will modify existing transaction data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reprocessPlaidTransactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const index_1 = require("../../../index");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../types");
exports.reprocessPlaidTransactions = (0, https_1.onCall)({
    memory: '512MiB',
    timeoutSeconds: 300,
}, async (request) => {
    var _a, _b, _c;
    try {
        console.log('🔄 Starting Plaid transaction reprocessing...');
        const { userId, limit = 100, dryRun = false } = request.data;
        // Query transactions to reprocess
        let query = index_1.db.collection('transactions')
            .where('metadata.source', '==', 'plaid');
        if (userId) {
            query = query.where('userId', '==', userId);
        }
        query = query.limit(limit);
        const snapshot = await query.get();
        console.log(`Found ${snapshot.size} Plaid transactions to reprocess`);
        let updatedCount = 0;
        let skippedCount = 0;
        const changes = [];
        for (const doc of snapshot.docs) {
            const transaction = doc.data();
            const plaidTransactionId = (_a = transaction.metadata) === null || _a === void 0 ? void 0 : _a.plaidTransactionId;
            if (!plaidTransactionId) {
                console.warn(`Transaction ${doc.id} missing plaidTransactionId`);
                skippedCount++;
                continue;
            }
            // Get the original Plaid transaction data
            // In the unified sync, we use Plaid transaction ID as document ID
            const plaidTransaction = transaction;
            // Re-map category
            const oldCategory = transaction.category;
            const newCategory = await remapCategory(plaidTransaction);
            // Re-match budget period
            const transactionDate = transaction.date instanceof firestore_1.Timestamp
                ? transaction.date.toDate()
                : new Date(transaction.date);
            const { budgetId: newBudgetId, budgetPeriodId: newBudgetPeriodId, budgetName: newBudgetName } = await rematchBudgetPeriod(transaction.userId, transactionDate);
            // Check if anything changed
            const hasChanges = newCategory !== oldCategory ||
                newBudgetId !== transaction.budgetId ||
                newBudgetPeriodId !== (((_c = (_b = transaction.splits) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.budgetPeriodId) || 'unassigned');
            if (hasChanges) {
                const updateData = {
                    updatedAt: firestore_1.Timestamp.now()
                };
                const changeLog = {
                    transactionId: doc.id,
                    merchant: transaction.description,
                    date: transactionDate.toISOString(),
                    changes: {}
                };
                if (newCategory !== oldCategory) {
                    updateData.category = newCategory;
                    changeLog.changes.category = { from: oldCategory, to: newCategory };
                }
                if (newBudgetId !== transaction.budgetId) {
                    updateData.budgetId = newBudgetId;
                    updateData.primaryBudgetId = newBudgetId;
                    changeLog.changes.budgetId = { from: transaction.budgetId, to: newBudgetId };
                }
                // Update split if budget period changed
                if (transaction.splits && transaction.splits.length > 0) {
                    const updatedSplit = Object.assign(Object.assign({}, transaction.splits[0]), { budgetId: newBudgetId || 'unassigned', budgetPeriodId: newBudgetPeriodId, budgetName: newBudgetName, categoryId: newCategory, updatedAt: firestore_1.Timestamp.now() });
                    updateData.splits = [updatedSplit];
                    updateData.affectedBudgets = newBudgetId ? [newBudgetId] : [];
                    updateData.affectedBudgetPeriods = newBudgetPeriodId !== 'unassigned' ? [newBudgetPeriodId] : [];
                    updateData.primaryBudgetPeriodId = newBudgetPeriodId !== 'unassigned' ? newBudgetPeriodId : undefined;
                    changeLog.changes.split = {
                        from: {
                            budgetPeriodId: transaction.splits[0].budgetPeriodId,
                            budgetName: transaction.splits[0].budgetName
                        },
                        to: {
                            budgetPeriodId: newBudgetPeriodId,
                            budgetName: newBudgetName
                        }
                    };
                }
                console.log(`${dryRun ? '[DRY RUN]' : ''} Updating transaction ${doc.id}:`, changeLog);
                if (!dryRun) {
                    await doc.ref.update(updateData);
                }
                changes.push(changeLog);
                updatedCount++;
            }
            else {
                skippedCount++;
            }
        }
        const summary = {
            success: true,
            totalProcessed: snapshot.size,
            updatedCount,
            skippedCount,
            dryRun,
            changes: changes.slice(0, 10), // Return first 10 changes
            message: dryRun
                ? `Dry run complete. Would update ${updatedCount} transactions`
                : `Updated ${updatedCount} transactions, skipped ${skippedCount}`
        };
        console.log('✅ Reprocessing complete:', summary);
        return summary;
    }
    catch (error) {
        console.error('❌ Error reprocessing transactions:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to reprocess transactions');
    }
});
/**
 * Re-map Plaid category to our transaction category
 */
async function remapCategory(transaction) {
    var _a, _b;
    const plaidCategories = ((_a = transaction.metadata) === null || _a === void 0 ? void 0 : _a.plaidCategory) || [];
    if (!plaidCategories || plaidCategories.length === 0) {
        return types_1.TransactionCategory.OTHER_EXPENSE;
    }
    const primaryCategory = plaidCategories[0].toLowerCase();
    const secondaryCategory = ((_b = plaidCategories[1]) === null || _b === void 0 ? void 0 : _b.toLowerCase()) || '';
    // Map common Plaid categories to our categories
    const categoryMappings = {
        // Food & Dining
        'food and drink': types_1.TransactionCategory.FOOD,
        'restaurants': types_1.TransactionCategory.FOOD,
        'fast food': types_1.TransactionCategory.FOOD,
        'coffee shops': types_1.TransactionCategory.FOOD,
        'groceries': types_1.TransactionCategory.FOOD,
        // Transportation
        'transportation': types_1.TransactionCategory.TRANSPORTATION,
        'gas stations': types_1.TransactionCategory.TRANSPORTATION,
        'public transportation': types_1.TransactionCategory.TRANSPORTATION,
        'ride share': types_1.TransactionCategory.TRANSPORTATION,
        'parking': types_1.TransactionCategory.TRANSPORTATION,
        'airlines': types_1.TransactionCategory.TRANSPORTATION,
        // Shopping & Clothing
        'shops': types_1.TransactionCategory.CLOTHING,
        'retail': types_1.TransactionCategory.CLOTHING,
        'clothing': types_1.TransactionCategory.CLOTHING,
        'department stores': types_1.TransactionCategory.CLOTHING,
        // Entertainment
        'entertainment': types_1.TransactionCategory.ENTERTAINMENT,
        'movies': types_1.TransactionCategory.ENTERTAINMENT,
        'music': types_1.TransactionCategory.ENTERTAINMENT,
        'sports': types_1.TransactionCategory.ENTERTAINMENT,
        'recreation': types_1.TransactionCategory.ENTERTAINMENT,
        // Healthcare
        'healthcare': types_1.TransactionCategory.HEALTHCARE,
        'medical': types_1.TransactionCategory.HEALTHCARE,
        'pharmacy': types_1.TransactionCategory.HEALTHCARE,
        'dentist': types_1.TransactionCategory.HEALTHCARE,
        // Utilities
        'utilities': types_1.TransactionCategory.UTILITIES,
        'internet': types_1.TransactionCategory.UTILITIES,
        'phone': types_1.TransactionCategory.UTILITIES,
        'cable': types_1.TransactionCategory.UTILITIES,
        // Housing
        'rent': types_1.TransactionCategory.HOUSING,
        'mortgage': types_1.TransactionCategory.HOUSING,
        'home improvement': types_1.TransactionCategory.HOUSING,
        // Travel
        'travel': types_1.TransactionCategory.TRANSPORTATION,
        'hotels': types_1.TransactionCategory.HOUSING,
        // Income
        'payroll': types_1.TransactionCategory.SALARY,
        'deposit': types_1.TransactionCategory.OTHER_INCOME,
    };
    // Check primary category first
    if (categoryMappings[primaryCategory]) {
        return categoryMappings[primaryCategory];
    }
    // Check secondary category
    if (categoryMappings[secondaryCategory]) {
        return categoryMappings[secondaryCategory];
    }
    // Check if any category contains certain keywords
    const allCategories = plaidCategories.join(' ').toLowerCase();
    if (allCategories.includes('food') || allCategories.includes('restaurant') || allCategories.includes('grocery')) {
        return types_1.TransactionCategory.FOOD;
    }
    if (allCategories.includes('gas') || allCategories.includes('fuel') || allCategories.includes('transport') || allCategories.includes('airline')) {
        return types_1.TransactionCategory.TRANSPORTATION;
    }
    if (allCategories.includes('clothing') || allCategories.includes('apparel')) {
        return types_1.TransactionCategory.CLOTHING;
    }
    if (allCategories.includes('entertainment') || allCategories.includes('movie') || allCategories.includes('game')) {
        return types_1.TransactionCategory.ENTERTAINMENT;
    }
    // Default to OTHER_EXPENSE if no mapping found
    return types_1.TransactionCategory.OTHER_EXPENSE;
}
/**
 * Re-match transaction to budget period based on date
 */
async function rematchBudgetPeriod(userId, transactionDate) {
    const transactionTimestamp = firestore_1.Timestamp.fromDate(transactionDate);
    // Query all active budget periods for the user
    const budgetPeriodsSnapshot = await index_1.db.collection('budget_periods')
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .get();
    console.log(`  Found ${budgetPeriodsSnapshot.size} active budget periods for user ${userId}`);
    // Filter to find budget period that contains the transaction date
    for (const doc of budgetPeriodsSnapshot.docs) {
        const period = doc.data();
        const periodStart = period.periodStartDate || period.periodStart;
        const periodEnd = period.periodEndDate || period.periodEnd;
        if (periodStart && periodEnd) {
            const startTimestamp = periodStart instanceof firestore_1.Timestamp ? periodStart : firestore_1.Timestamp.fromDate(new Date(periodStart));
            const endTimestamp = periodEnd instanceof firestore_1.Timestamp ? periodEnd : firestore_1.Timestamp.fromDate(new Date(periodEnd));
            // Check if transaction date falls within this period
            if (transactionTimestamp.toMillis() >= startTimestamp.toMillis() &&
                transactionTimestamp.toMillis() <= endTimestamp.toMillis()) {
                return {
                    budgetId: period.budgetId,
                    budgetPeriodId: doc.id,
                    budgetName: period.budgetName || 'General'
                };
            }
        }
    }
    // No match found
    return {
        budgetId: undefined,
        budgetPeriodId: 'unassigned',
        budgetName: 'General'
    };
}
//# sourceMappingURL=migrateTransactionSplits.js.map