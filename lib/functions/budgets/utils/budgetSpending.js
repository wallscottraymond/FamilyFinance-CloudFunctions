"use strict";
/**
 * Budget Spending Update Utility
 *
 * Handles updating budget_periods spent amounts when transactions are created, updated, or deleted.
 *
 * Uses date-based period assignment: transactions are only applied to budget periods where
 * the transaction date falls within the period's start and end dates (inclusive).
 *
 * Also provides recalculation functionality when budgets are created to include historical transactions.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBudgetSpending = updateBudgetSpending;
exports.recalculateBudgetSpendingOnCreate = recalculateBudgetSpendingOnCreate;
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../types");
const db = admin.firestore();
/**
 * Main entry point for updating budget spending based on transaction changes
 *
 * Updates only budget periods where the transaction date falls within the period's date range
 */
async function updateBudgetSpending(params) {
    const { oldTransaction, newTransaction, userId } = params;
    console.log('💰 updateBudgetSpending called:', {
        hasOld: !!oldTransaction,
        hasNew: !!newTransaction,
        userId,
        oldId: oldTransaction === null || oldTransaction === void 0 ? void 0 : oldTransaction.id,
        newId: newTransaction === null || newTransaction === void 0 ? void 0 : newTransaction.id
    });
    const result = {
        budgetPeriodsUpdated: 0,
        budgetsAffected: [],
        errors: [],
        periodTypesUpdated: {
            weekly: 0,
            bi_monthly: 0,
            monthly: 0
        }
    };
    try {
        // Calculate spending deltas for each affected budget
        const deltas = calculateSpendingDeltas(oldTransaction, newTransaction);
        console.log('💰 Calculated deltas for budgets:', Object.fromEntries(deltas));
        if (deltas.size === 0) {
            console.log('💰 No budget updates needed');
            return result;
        }
        // Get transaction date (use new transaction if available, otherwise old)
        const transaction = newTransaction || oldTransaction;
        const transactionDate = transaction === null || transaction === void 0 ? void 0 : transaction.transactionDate;
        if (!transactionDate) {
            console.warn('⚠️ No transaction date available, skipping budget updates');
            return result;
        }
        // Update each affected budget's periods
        for (const [budgetId, delta] of deltas) {
            if (budgetId === 'unassigned') {
                console.log('💰 Skipping unassigned budget');
                continue;
            }
            try {
                const updateResult = await updateBudgetPeriodSpending(budgetId, delta, userId, transactionDate);
                result.budgetPeriodsUpdated += updateResult.totalUpdated;
                result.periodTypesUpdated.weekly += updateResult.weeklyUpdated;
                result.periodTypesUpdated.bi_monthly += updateResult.biMonthlyUpdated;
                result.periodTypesUpdated.monthly += updateResult.monthlyUpdated;
                result.budgetsAffected.push(budgetId);
            }
            catch (error) {
                const errorMsg = `Failed to update budget ${budgetId}: ${error}`;
                console.error('❌', errorMsg);
                result.errors.push(errorMsg);
            }
        }
        console.log('✅ Budget spending update complete:', result);
        return result;
    }
    catch (error) {
        console.error('❌ Error in updateBudgetSpending:', error);
        result.errors.push(`Update failed: ${error}`);
        return result;
    }
}
/**
 * Extract budget spending amounts from a transaction's splits
 */
function getAffectedBudgets(transaction) {
    const budgetSpending = new Map();
    // Only count approved expense transactions
    if (transaction.transactionStatus !== types_1.TransactionStatus.APPROVED) {
        console.log('💰 Transaction not approved, skipping:', transaction.transactionStatus);
        return budgetSpending;
    }
    if (transaction.type !== types_1.TransactionType.EXPENSE) {
        console.log('💰 Transaction not an expense, skipping:', transaction.type);
        return budgetSpending;
    }
    // Sum up spending by budget from splits
    for (const split of transaction.splits || []) {
        const budgetId = split.budgetId;
        const amount = split.amount;
        if (budgetId && budgetId !== 'unassigned') {
            const current = budgetSpending.get(budgetId) || 0;
            budgetSpending.set(budgetId, current + amount);
            console.log('💰 Split found:', {
                budgetId,
                // budgetName removed - lookup from budgetId if needed,
                splitAmount: amount,
                totalForBudget: current + amount
            });
        }
    }
    return budgetSpending;
}
/**
 * Calculate the delta (change) in spending for each budget
 */
function calculateSpendingDeltas(oldTransaction, newTransaction) {
    const oldSpending = oldTransaction ? getAffectedBudgets(oldTransaction) : new Map();
    const newSpending = newTransaction ? getAffectedBudgets(newTransaction) : new Map();
    const deltas = new Map();
    // Get all affected budget IDs from both old and new
    const allBudgetIds = new Set([
        ...oldSpending.keys(),
        ...newSpending.keys()
    ]);
    // Calculate delta for each budget
    for (const budgetId of allBudgetIds) {
        const oldAmount = oldSpending.get(budgetId) || 0;
        const newAmount = newSpending.get(budgetId) || 0;
        const delta = newAmount - oldAmount;
        if (delta !== 0) {
            deltas.set(budgetId, delta);
            console.log('💰 Delta calculated:', {
                budgetId,
                oldAmount,
                newAmount,
                delta
            });
        }
    }
    return deltas;
}
/**
 * Update budget periods for a given budget, filtering by transaction date
 *
 * Only updates periods where the transaction date falls within the period's start and end dates (inclusive)
 */
async function updateBudgetPeriodSpending(budgetId, spendingDelta, userId, transactionDate) {
    console.log(`📊 Updating spending for budget ${budgetId}, delta: ${spendingDelta}, transaction date: ${transactionDate.toDate().toISOString()}`);
    const result = {
        totalUpdated: 0,
        weeklyUpdated: 0,
        biMonthlyUpdated: 0,
        monthlyUpdated: 0
    };
    // Query for ALL budget_periods of this budget (all period types)
    const budgetPeriods = await db.collection('budget_periods')
        .where('budgetId', '==', budgetId)
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .get();
    console.log(`📊 Found ${budgetPeriods.size} total budget periods for budget ${budgetId}`);
    if (budgetPeriods.empty) {
        console.warn(`⚠️ No budget periods found for budget ${budgetId}`);
        return result;
    }
    // Convert transaction date to milliseconds for comparison
    const transactionMs = transactionDate.toMillis();
    // Filter periods where transaction date falls within period date range
    const matchingPeriods = [];
    budgetPeriods.forEach(periodDoc => {
        const periodData = periodDoc.data();
        const startDate = periodData.startDate;
        const endDate = periodData.endDate;
        if (!startDate || !endDate) {
            console.warn(`⚠️ Period ${periodDoc.id} missing startDate or endDate`);
            return;
        }
        const startMs = startDate.toMillis();
        const endMs = endDate.toMillis();
        // Check if transaction date is within period range (inclusive)
        if (transactionMs >= startMs && transactionMs <= endMs) {
            matchingPeriods.push(periodDoc);
            console.log(`✅ Transaction date matches period ${periodData.periodId} (${periodData.periodType}):`, {
                transactionDate: transactionDate.toDate().toISOString(),
                periodStart: startDate.toDate().toISOString(),
                periodEnd: endDate.toDate().toISOString()
            });
        }
    });
    console.log(`📊 Found ${matchingPeriods.length} periods matching transaction date`);
    if (matchingPeriods.length === 0) {
        console.warn(`⚠️ No budget periods found for transaction date ${transactionDate.toDate().toISOString()}`);
        return result;
    }
    // Update matching periods using batch writes
    const batch = db.batch();
    matchingPeriods.forEach(periodDoc => {
        const periodData = periodDoc.data();
        if (!periodData) {
            console.warn(`⚠️ Period ${periodDoc.id} has no data`);
            return;
        }
        const currentSpent = periodData.spent || 0;
        const allocatedAmount = periodData.modifiedAmount || periodData.allocatedAmount || 0;
        // Calculate new values
        const newSpent = currentSpent + spendingDelta;
        const newRemaining = allocatedAmount - newSpent;
        console.log(`📊 Updating budget_period ${periodDoc.id}:`, {
            periodType: periodData.periodType,
            periodId: periodData.periodId,
            budgetName: periodData.budgetName, // TODO: Remove this field
            oldSpent: currentSpent,
            delta: spendingDelta,
            newSpent: newSpent,
            allocated: allocatedAmount,
            newRemaining: newRemaining
        });
        batch.update(periodDoc.ref, {
            spent: newSpent,
            remaining: newRemaining,
            updatedAt: admin.firestore.Timestamp.now()
        });
        // Track counts by period type
        const periodType = periodData.periodType;
        if (periodType === types_1.PeriodType.WEEKLY) {
            result.weeklyUpdated++;
        }
        else if (periodType === types_1.PeriodType.BI_MONTHLY) {
            result.biMonthlyUpdated++;
        }
        else if (periodType === types_1.PeriodType.MONTHLY) {
            result.monthlyUpdated++;
        }
        result.totalUpdated++;
    });
    await batch.commit();
    console.log(`✅ Updated ${matchingPeriods.length} budget periods for budget ${budgetId}:`, result);
    return result;
}
/**
 * Recalculate budget spending when a new budget is created
 *
 * Finds ALL existing approved expense transactions that match the budget's categories
 * and assigns spending to budget periods based on transaction dates.
 * Each transaction is only applied to periods where the transaction date falls within the period's date range.
 */
async function recalculateBudgetSpendingOnCreate(budgetId, budget) {
    console.log(`🔄 Recalculating spending for newly created budget: ${budgetId}`);
    console.log(`🔄 Budget categories:`, budget.categoryIds);
    const result = {
        transactionsProcessed: 0,
        totalSpending: 0,
        budgetPeriodsUpdated: 0,
        periodTypesUpdated: {
            weekly: 0,
            bi_monthly: 0,
            monthly: 0
        },
        errors: []
    };
    try {
        // Find ALL approved expense transactions that match ANY of the budget's categories
        const transactionsSnapshot = await db.collection('transactions')
            .where('userId', '==', budget.createdBy)
            .where('status', '==', types_1.TransactionStatus.APPROVED)
            .where('type', '==', types_1.TransactionType.EXPENSE)
            .get();
        console.log(`🔄 Found ${transactionsSnapshot.size} total approved expense transactions for user`);
        // Get ALL budget periods for this budget
        const budgetPeriodsSnapshot = await db.collection('budget_periods')
            .where('budgetId', '==', budgetId)
            .where('userId', '==', budget.createdBy)
            .where('isActive', '==', true)
            .get();
        console.log(`🔄 Found ${budgetPeriodsSnapshot.size} budget periods`);
        if (budgetPeriodsSnapshot.empty) {
            console.warn(`⚠️ No budget periods found for budget ${budgetId}`);
            return result;
        }
        // Build a map of period spending: periodDocId -> spending amount
        const periodSpending = new Map();
        // Initialize all periods to 0 spending
        budgetPeriodsSnapshot.forEach(periodDoc => {
            periodSpending.set(periodDoc.id, 0);
        });
        // Process each transaction
        let totalSpending = 0;
        transactionsSnapshot.forEach(doc => {
            const transaction = Object.assign({ id: doc.id }, doc.data());
            // Check if any split's category matches budget categories
            const matchingSplits = (transaction.splits || []).filter(split => budget.categoryIds.includes(split.plaidPrimaryCategory));
            if (matchingSplits.length === 0) {
                return; // Skip this transaction
            }
            // Sum up spending from matching splits
            const transactionSpending = matchingSplits.reduce((sum, split) => sum + split.amount, 0);
            totalSpending += transactionSpending;
            result.transactionsProcessed++;
            const transactionDate = transaction.transactionDate;
            const transactionMs = transactionDate.toMillis();
            console.log(`🔄 Processing transaction ${transaction.id}:`, {
                description: transaction.description,
                date: transactionDate.toDate().toISOString(),
                matchingSplits: matchingSplits.length,
                spending: transactionSpending
            });
            // Find matching periods for this transaction date
            budgetPeriodsSnapshot.forEach(periodDoc => {
                const periodData = periodDoc.data();
                const startDate = periodData.startDate;
                const endDate = periodData.endDate;
                if (!startDate || !endDate) {
                    return;
                }
                const startMs = startDate.toMillis();
                const endMs = endDate.toMillis();
                // Check if transaction date is within period range (inclusive)
                if (transactionMs >= startMs && transactionMs <= endMs) {
                    const currentSpending = periodSpending.get(periodDoc.id) || 0;
                    periodSpending.set(periodDoc.id, currentSpending + transactionSpending);
                    console.log(`  ✅ Assigned to period ${periodData.periodId} (${periodData.periodType})`);
                }
            });
        });
        console.log(`🔄 Total transactions processed: ${result.transactionsProcessed}`);
        console.log(`🔄 Total spending: ${totalSpending}`);
        result.totalSpending = totalSpending;
        // Update budget periods with calculated spending
        const batch = db.batch();
        const updatedPeriodIds = new Set();
        budgetPeriodsSnapshot.forEach(periodDoc => {
            const periodData = periodDoc.data();
            const spending = periodSpending.get(periodDoc.id) || 0;
            // Only update if there's spending for this period
            if (spending > 0) {
                const allocatedAmount = periodData.modifiedAmount || periodData.allocatedAmount || 0;
                const newRemaining = allocatedAmount - spending;
                console.log(`🔄 Updating budget_period ${periodDoc.id}:`, {
                    periodType: periodData.periodType,
                    periodId: periodData.periodId,
                    budgetName: periodData.budgetName, // TODO: Remove this field
                    spent: spending,
                    allocated: allocatedAmount,
                    remaining: newRemaining
                });
                batch.update(periodDoc.ref, {
                    spent: spending,
                    remaining: newRemaining,
                    updatedAt: admin.firestore.Timestamp.now()
                });
                updatedPeriodIds.add(periodDoc.id);
                // Track counts by period type
                const periodType = periodData.periodType;
                if (periodType === types_1.PeriodType.WEEKLY) {
                    result.periodTypesUpdated.weekly++;
                }
                else if (periodType === types_1.PeriodType.BI_MONTHLY) {
                    result.periodTypesUpdated.bi_monthly++;
                }
                else if (periodType === types_1.PeriodType.MONTHLY) {
                    result.periodTypesUpdated.monthly++;
                }
                result.budgetPeriodsUpdated++;
            }
        });
        if (updatedPeriodIds.size > 0) {
            await batch.commit();
        }
        console.log(`✅ Recalculation complete for budget ${budgetId}:`, result);
        return result;
    }
    catch (error) {
        console.error(`❌ Error recalculating budget spending for ${budgetId}:`, error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push(`Recalculation failed: ${errorMessage}`);
        return result;
    }
}
//# sourceMappingURL=budgetSpending.js.map