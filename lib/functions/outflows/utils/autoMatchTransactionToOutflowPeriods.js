"use strict";
// @ts-nocheck
/**
 * Auto-Match Transaction Splits to Outflow Periods
 *
 * Automatically matches an outflow's historical transactions to appropriate outflow periods.
 * Called by onOutflowCreated trigger after periods are generated.
 *
 * Matching logic:
 * 1. Get all transactions referenced in outflow.transactionIds
 * 2. For each transaction, find the matching outflow period based on transaction date
 * 3. For each split in the transaction, assign it to the appropriate outflow period
 * 4. Determine payment type (regular, catch_up, advance, extra_principal)
 * 5. Update transaction split with outflow assignment
 * 6. Add TransactionSplitReference to outflow period
 * 7. Recalculate outflow period statuses
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
exports.autoMatchTransactionToOutflowPeriods = autoMatchTransactionToOutflowPeriods;
exports.recalculateOutflowPeriodStatuses = recalculateOutflowPeriodStatuses;
exports.orchestrateAutoMatchingWorkflow = orchestrateAutoMatchingWorkflow;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../types");
const calculateOutflowPeriodStatus_1 = require("./calculateOutflowPeriodStatus");
/**
 * Automatically match outflow's historical transactions to outflow periods
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data
 * @param createdPeriodIds - Array of outflow period IDs that were just created
 * @returns Result with counts of matches and any errors
 */
async function autoMatchTransactionToOutflowPeriods(db, outflowId, outflow, createdPeriodIds) {
    const result = {
        transactionsProcessed: 0,
        splitsAssigned: 0,
        periodsUpdated: 0,
        errors: []
    };
    try {
        console.log(`[autoMatch] Starting auto-match for outflow ${outflowId}, ${outflow.transactionIds.length} transactions`);
        // Check if there are any transactions to match
        if (!outflow.transactionIds || outflow.transactionIds.length === 0) {
            console.log(`[autoMatch] No transaction IDs in outflow, skipping auto-match`);
            return result;
        }
        // Step 1: Get all outflow periods that were just created
        const outflowPeriods = await getOutflowPeriods(db, createdPeriodIds);
        if (outflowPeriods.length === 0) {
            console.warn(`[autoMatch] No outflow periods found with IDs: ${createdPeriodIds.join(', ')}`);
            return result;
        }
        console.log(`[autoMatch] Found ${outflowPeriods.length} outflow periods to match against`);
        // Step 2: Get all transactions referenced in transactionIds array
        // Note: transactionIds are Plaid transaction IDs, which are now used as document IDs
        const transactions = await getTransactionsByPlaidIds(db, outflow.transactionIds, outflow.userId || outflow.ownerId || '');
        console.log(`[autoMatch] Found ${transactions.length} transactions to process`);
        // Step 3: For each transaction, match splits to appropriate outflow periods
        for (const transaction of transactions) {
            try {
                await matchTransactionToOutflowPeriods(db, transaction, outflow, outflowPeriods, result);
                result.transactionsProcessed++;
            }
            catch (error) {
                const errorMsg = `Failed to match transaction ${transaction.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
                result.errors.push(errorMsg);
                console.error(`[autoMatch] ${errorMsg}`);
            }
        }
        console.log(`[autoMatch] Auto-match complete: ${result.splitsAssigned} splits assigned to ${result.periodsUpdated} periods`);
        return result;
    }
    catch (error) {
        const errorMsg = `Auto-match failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        console.error(`[autoMatch] ${errorMsg}`);
        return result;
    }
}
/**
 * Get outflow periods by IDs
 */
async function getOutflowPeriods(db, periodIds) {
    if (periodIds.length === 0)
        return [];
    const periods = [];
    // Firestore 'in' queries are limited to 10 items, so batch if needed
    const BATCH_SIZE = 10;
    for (let i = 0; i < periodIds.length; i += BATCH_SIZE) {
        const batchIds = periodIds.slice(i, i + BATCH_SIZE);
        const snapshot = await db.collection('outflow_periods')
            .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
            .get();
        snapshot.docs.forEach(doc => {
            periods.push(Object.assign({ id: doc.id }, doc.data()));
        });
    }
    return periods;
}
/**
 * Get transactions by Plaid transaction IDs
 *
 * Handles both old and new transaction formats:
 * - NEW: Plaid transaction ID is the document ID
 * - OLD: Plaid transaction ID is in metadata.plaidTransactionId
 */
async function getTransactionsByPlaidIds(db, plaidTransactionIds, userId) {
    if (plaidTransactionIds.length === 0)
        return [];
    const transactions = [];
    const foundIds = new Set();
    // Firestore 'in' queries are limited to 10 items, so batch if needed
    const BATCH_SIZE = 10;
    for (let i = 0; i < plaidTransactionIds.length; i += BATCH_SIZE) {
        const batchIds = plaidTransactionIds.slice(i, i + BATCH_SIZE);
        // FIRST: Try to fetch transactions directly by document ID (NEW format)
        // Use getAll() for efficient batch reading instead of Promise.all with individual gets
        const docRefs = batchIds.map(id => db.collection('transactions').doc(id));
        const docs = await db.getAll(...docRefs);
        docs.forEach(doc => {
            if (doc.exists) {
                const data = doc.data();
                // Verify it belongs to the same user
                if (data && data.userId === userId) {
                    transactions.push(Object.assign({ id: doc.id }, data));
                    foundIds.add(doc.id);
                }
            }
        });
        // SECOND: For any IDs not found, query by metadata.plaidTransactionId (OLD format)
        const notFoundIds = batchIds.filter(id => !foundIds.has(id));
        if (notFoundIds.length > 0) {
            const querySnapshot = await db.collection('transactions')
                .where('userId', '==', userId)
                .where('metadata.plaidTransactionId', 'in', notFoundIds)
                .get();
            querySnapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data && !foundIds.has(doc.id)) {
                    transactions.push(Object.assign({ id: doc.id }, data));
                    foundIds.add(doc.id);
                }
            });
        }
    }
    console.log(`[getTransactionsByPlaidIds] Found ${transactions.length} transactions out of ${plaidTransactionIds.length} requested`);
    return transactions;
}
/**
 * Match a single transaction to outflow periods
 *
 * IMPORTANT: This function must assign splits to ALL THREE period types
 * (monthly, weekly, bi-weekly) to maintain consistency across period views.
 */
async function matchTransactionToOutflowPeriods(db, transaction, outflow, outflowPeriods, result) {
    // Find ALL THREE matching period types (monthly, weekly, bi-weekly)
    const matchingPeriods = findAllMatchingOutflowPeriods(transaction.date, outflowPeriods);
    if (matchingPeriods.foundCount === 0) {
        console.warn(`[autoMatch] No matching periods found for transaction ${transaction.id} dated ${transaction.date.toDate().toISOString()}`);
        return;
    }
    console.log(`[autoMatch] Matching transaction ${transaction.id} to ${matchingPeriods.foundCount} periods`);
    // Process each split in the transaction
    for (const split of transaction.splits) {
        // Skip if already assigned to budget or another outflow
        if ((split.budgetId && split.budgetId !== '' && split.budgetId !== 'unassigned') || split.outflowPeriodId) {
            console.log(`[autoMatch] Split ${split.id} already assigned, skipping`);
            continue;
        }
        // Determine payment type (use monthly period if available, otherwise first found)
        const primaryPeriod = matchingPeriods.monthlyPeriod ||
            matchingPeriods.weeklyPeriod ||
            matchingPeriods.biWeeklyPeriod;
        if (!primaryPeriod) {
            console.warn(`[autoMatch] No primary period found for split ${split.id}`);
            continue;
        }
        const paymentType = determinePaymentType(split.amount, transaction.date, primaryPeriod);
        // Create TransactionSplitReference for each period type
        const splitRef = {
            transactionId: transaction.id,
            splitId: split.id,
            transactionDate: transaction.date,
            amount: split.amount,
            description: transaction.description,
            paymentType,
            isAutoMatched: true,
            matchedAt: firestore_1.Timestamp.now(),
            matchedBy: 'system'
        };
        // Update transaction split with ALL THREE period assignments
        await updateTransactionSplitWithAllOutflowPeriods(db, transaction.id, split, matchingPeriods, outflow, paymentType, transaction.date);
        // Add split reference to ALL outflow periods (monthly, weekly, bi-weekly)
        const periodIdsToUpdate = [];
        if (matchingPeriods.monthlyPeriod) {
            await addSplitReferenceToOutflowPeriod(db, matchingPeriods.monthlyPeriod.id, splitRef);
            periodIdsToUpdate.push(matchingPeriods.monthlyPeriod.id);
        }
        if (matchingPeriods.weeklyPeriod) {
            await addSplitReferenceToOutflowPeriod(db, matchingPeriods.weeklyPeriod.id, splitRef);
            periodIdsToUpdate.push(matchingPeriods.weeklyPeriod.id);
        }
        if (matchingPeriods.biWeeklyPeriod) {
            await addSplitReferenceToOutflowPeriod(db, matchingPeriods.biWeeklyPeriod.id, splitRef);
            periodIdsToUpdate.push(matchingPeriods.biWeeklyPeriod.id);
        }
        result.splitsAssigned++;
        console.log(`[autoMatch] Assigned split ${split.id} to ${periodIdsToUpdate.length} periods as ${paymentType}`);
    }
    // Mark periods as updated (for recalculation)
    if (!result.periodsUpdated) {
        result.periodsUpdated = 0;
    }
    result.periodsUpdated += matchingPeriods.foundCount;
}
/**
 * Find ALL THREE matching outflow period types (monthly, weekly, bi-weekly)
 *
 * This ensures consistency across all period views when auto-matching transactions.
 */
function findAllMatchingOutflowPeriods(transactionDate, outflowPeriods) {
    const txnMs = transactionDate.toMillis();
    const result = {
        monthlyPeriod: null,
        weeklyPeriod: null,
        biWeeklyPeriod: null,
        foundCount: 0
    };
    for (const period of outflowPeriods) {
        const startMs = period.periodStartDate.toMillis();
        const endMs = period.periodEndDate.toMillis();
        // Check if transaction date falls within this period
        if (txnMs >= startMs && txnMs <= endMs) {
            // Separate by period type (using lowercase enum values)
            if (period.periodType === 'monthly') {
                result.monthlyPeriod = period;
                result.foundCount++;
            }
            else if (period.periodType === 'weekly') {
                result.weeklyPeriod = period;
                result.foundCount++;
            }
            else if (period.periodType === 'bi_monthly') {
                result.biWeeklyPeriod = period;
                result.foundCount++;
            }
        }
    }
    return result;
}
/**
 * Determine payment type based on amount, date, and period info
 */
function determinePaymentType(splitAmount, transactionDate, outflowPeriod) {
    const txnMs = transactionDate.toMillis();
    const now = firestore_1.Timestamp.now().toMillis();
    // Check if this is an extra principal payment (amount exceeds bill amount)
    if (splitAmount > outflowPeriod.billAmount * 1.1) { // 10% tolerance for rounding
        return types_1.PaymentType.EXTRA_PRINCIPAL;
    }
    // Check if this is a catch-up payment (transaction is for a past-due period)
    if (outflowPeriod.isDuePeriod && outflowPeriod.dueDate) {
        const dueMs = outflowPeriod.dueDate.toMillis();
        if (txnMs < dueMs && dueMs < now) {
            // Payment was made before due date, but due date has passed
            return types_1.PaymentType.CATCH_UP;
        }
    }
    // Check if this is an advance payment (payment made well before due date)
    if (outflowPeriod.isDuePeriod && outflowPeriod.dueDate) {
        const dueMs = outflowPeriod.dueDate.toMillis();
        const daysBeforeDue = (dueMs - txnMs) / (1000 * 60 * 60 * 24);
        if (daysBeforeDue > 7) { // More than 7 days early
            return types_1.PaymentType.ADVANCE;
        }
    }
    // Default: regular payment
    return types_1.PaymentType.REGULAR;
}
/**
 * Update transaction split with ALL THREE outflow period assignments
 *
 * This ensures the split has references to monthly, weekly, and bi-weekly periods
 * so it appears correctly in all period views.
 */
async function updateTransactionSplitWithAllOutflowPeriods(db, transactionId, split, matchingPeriods, outflow, paymentType, paymentDate) {
    var _a, _b, _c, _d, _e, _f, _g;
    const transactionRef = db.collection('transactions').doc(transactionId);
    // Update the specific split in the splits array
    const transactionDoc = await transactionRef.get();
    if (!transactionDoc.exists) {
        throw new Error(`Transaction ${transactionId} not found`);
    }
    const transactionData = transactionDoc.data();
    const splits = transactionData.splits || [];
    // Find and update the split
    const splitIndex = splits.findIndex(s => s.id === split.id);
    if (splitIndex === -1) {
        throw new Error(`Split ${split.id} not found in transaction ${transactionId}`);
    }
    // Primary period ID (prefer monthly, fallback to weekly, then bi-weekly)
    const primaryPeriodId = ((_a = matchingPeriods.monthlyPeriod) === null || _a === void 0 ? void 0 : _a.id) ||
        ((_b = matchingPeriods.weeklyPeriod) === null || _b === void 0 ? void 0 : _b.id) ||
        ((_c = matchingPeriods.biWeeklyPeriod) === null || _c === void 0 ? void 0 : _c.id);
    // Extract description based on structure (flat or nested)
    const outflowDescription = outflow.description || ((_d = outflow.metadata) === null || _d === void 0 ? void 0 : _d.outflowDescription) || '';
    splits[splitIndex] = Object.assign(Object.assign({}, splits[splitIndex]), { 
        // Outflow assignment
        outflowId: outflow.id, outflowDescription: outflowDescription, 
        // Primary period reference
        outflowPeriodId: primaryPeriodId, 
        // ALL THREE period type references
        outflowMonthlyPeriodId: ((_e = matchingPeriods.monthlyPeriod) === null || _e === void 0 ? void 0 : _e.id) || undefined, outflowWeeklyPeriodId: ((_f = matchingPeriods.weeklyPeriod) === null || _f === void 0 ? void 0 : _f.id) || undefined, outflowBiWeeklyPeriodId: ((_g = matchingPeriods.biWeeklyPeriod) === null || _g === void 0 ? void 0 : _g.id) || undefined, 
        // Payment tracking
        paymentType,
        paymentDate, updatedAt: firestore_1.Timestamp.now() });
    // Update the transaction
    await transactionRef.update({
        splits,
        updatedAt: firestore_1.Timestamp.now()
    });
}
/**
 * Add split reference to outflow period's transactionSplits array
 */
async function addSplitReferenceToOutflowPeriod(db, outflowPeriodId, splitRef) {
    const periodRef = db.collection('outflow_periods').doc(outflowPeriodId);
    // Use arrayUnion to add the split reference
    await periodRef.update({
        transactionSplits: admin.firestore.FieldValue.arrayUnion(splitRef),
        updatedAt: firestore_1.Timestamp.now()
    });
}
/**
 * Recalculate status for all updated outflow periods
 */
async function recalculateOutflowPeriodStatuses(db, periodIds) {
    if (periodIds.length === 0)
        return 0;
    let updated = 0;
    for (const periodId of periodIds) {
        try {
            const periodRef = db.collection('outflow_periods').doc(periodId);
            const periodDoc = await periodRef.get();
            if (!periodDoc.exists) {
                console.warn(`[recalculateStatus] Period ${periodId} not found`);
                continue;
            }
            const period = Object.assign({ id: periodDoc.id }, periodDoc.data());
            // Calculate new status based on transaction splits
            const newStatus = (0, calculateOutflowPeriodStatus_1.calculateOutflowPeriodStatus)(period.isDuePeriod, period.dueDate, period.expectedDueDate, period.amountDue, period.transactionSplits || []);
            // Update if status changed
            if (newStatus !== period.status) {
                await periodRef.update({
                    status: newStatus,
                    updatedAt: firestore_1.Timestamp.now()
                });
                updated++;
                console.log(`[recalculateStatus] Updated period ${periodId} status: ${period.status} → ${newStatus}`);
            }
        }
        catch (error) {
            console.error(`[recalculateStatus] Error updating period ${periodId}:`, error);
        }
    }
    return updated;
}
/**
 * Orchestrate the complete auto-matching workflow
 *
 * This function coordinates:
 * 1. Auto-matching transactions to periods
 * 2. Recalculating period statuses
 * 3. Error handling and logging
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data
 * @param periodIds - Array of created period IDs
 * @returns Summary of the auto-matching operation
 */
async function orchestrateAutoMatchingWorkflow(db, outflowId, outflow, periodIds) {
    console.log(`[orchestrateAutoMatching] Starting auto-match for outflow ${outflowId}`);
    // Check if there are transactions to match
    if (!outflow.transactionIds || outflow.transactionIds.length === 0) {
        console.log(`[orchestrateAutoMatching] No transactions to match`);
        return {
            success: true,
            transactionsProcessed: 0,
            splitsAssigned: 0,
            periodsUpdated: 0,
            statusesUpdated: 0,
            errors: []
        };
    }
    console.log(`[orchestrateAutoMatching] Auto-matching ${outflow.transactionIds.length} historical transactions`);
    try {
        // Step 1: Auto-match transactions to periods
        const matchResult = await autoMatchTransactionToOutflowPeriods(db, outflowId, outflow, periodIds);
        console.log(`[orchestrateAutoMatching] Auto-match complete:`, {
            transactionsProcessed: matchResult.transactionsProcessed,
            splitsAssigned: matchResult.splitsAssigned,
            periodsUpdated: matchResult.periodsUpdated,
            errors: matchResult.errors.length
        });
        // Step 2: Recalculate statuses for updated periods
        let statusesUpdated = 0;
        if (matchResult.periodsUpdated > 0) {
            console.log(`[orchestrateAutoMatching] Recalculating statuses for ${matchResult.periodsUpdated} periods`);
            statusesUpdated = await recalculateOutflowPeriodStatuses(db, periodIds);
            console.log(`[orchestrateAutoMatching] Updated ${statusesUpdated} period statuses`);
        }
        // Step 3: Log any errors
        if (matchResult.errors.length > 0) {
            console.warn(`[orchestrateAutoMatching] Completed with ${matchResult.errors.length} errors:`, matchResult.errors);
        }
        return {
            success: true,
            transactionsProcessed: matchResult.transactionsProcessed,
            splitsAssigned: matchResult.splitsAssigned,
            periodsUpdated: matchResult.periodsUpdated,
            statusesUpdated,
            errors: matchResult.errors
        };
    }
    catch (error) {
        const errorMsg = `Auto-matching workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`[orchestrateAutoMatching] ${errorMsg}`);
        return {
            success: false,
            transactionsProcessed: 0,
            splitsAssigned: 0,
            periodsUpdated: 0,
            statusesUpdated: 0,
            errors: [errorMsg]
        };
    }
}
//# sourceMappingURL=autoMatchTransactionToOutflowPeriods.js.map