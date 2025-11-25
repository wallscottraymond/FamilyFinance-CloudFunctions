"use strict";
/**
 * Assign Split to All Outflow Periods - Callable Cloud Function
 *
 * Assigns a transaction split to ALL THREE outflow period types (monthly, weekly, bi-weekly)
 * simultaneously to maintain consistency across all period views in the app.
 *
 * CRITICAL: This is the ONLY supported method for assigning splits to outflows.
 * Always assigns to all three period types to keep views synchronized.
 *
 * PARAMETERS:
 * - transactionId: Transaction containing the split
 * - splitId: Specific split to assign
 * - outflowId: Parent outflow ID (not period ID!)
 * - paymentType: 'regular' | 'catch_up' | 'advance' | 'extra_principal'
 * - clearBudgetAssignment: Clear budget fields when moving to outflow
 * - targetPeriodId: Optional specific period for advance payments
 *
 * MATCHING MODES:
 * 1. Auto-detect (default): Uses transaction date to find matching periods
 * 2. Manual target: Uses targetPeriodId for advance payments across multiple periods
 *
 * RETURNS:
 * - success: boolean
 * - split: Updated transaction split with all period references
 * - monthlyPeriod, weeklyPeriod, biWeeklyPeriod: Updated period documents
 * - periodsUpdated: Count of periods updated (up to 3)
 *
 * PAYMENT TYPES:
 * - REGULAR: Normal on-time payment
 * - CATCH_UP: Payment for past-due bill
 * - ADVANCE: Payment > 7 days before due date
 * - EXTRA_PRINCIPAL: Payment exceeding required amount
 *
 * SECURITY:
 * - Requires EDITOR role or higher
 * - User must own transaction and outflow
 * - Cannot reassign split already assigned to another outflow
 *
 * See CLAUDE.md for detailed workflow examples and data architecture.
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
exports.assignSplitToAllOutflowPeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("../../../utils/auth");
const types_1 = require("../../../types");
const admin = __importStar(require("firebase-admin"));
const findMatchingOutflowPeriods_1 = require("../utils/findMatchingOutflowPeriods");
/**
 * Callable function to assign a transaction split to ALL outflow periods
 */
exports.assignSplitToAllOutflowPeriods = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    try {
        // Authenticate user (EDITOR role required)
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.EDITOR);
        const userId = authResult.user.uid;
        const { transactionId, splitId, outflowId, paymentType = 'regular', clearBudgetAssignment = false, targetPeriodId } = request.data;
        // Validate required fields
        if (!transactionId || !splitId || !outflowId) {
            throw new https_1.HttpsError('invalid-argument', 'transactionId, splitId, and outflowId are required');
        }
        // Validate payment type
        const validPaymentTypes = [
            types_1.PaymentType.REGULAR,
            types_1.PaymentType.CATCH_UP,
            types_1.PaymentType.ADVANCE,
            types_1.PaymentType.EXTRA_PRINCIPAL
        ];
        if (!validPaymentTypes.includes(paymentType)) {
            throw new https_1.HttpsError('invalid-argument', `Invalid payment type: ${paymentType}`);
        }
        console.log(`[assignSplitToAll] User ${userId} assigning split ${splitId} to outflow ${outflowId}`);
        const db = admin.firestore();
        // Step 1: Get and validate transaction
        const transactionRef = db.collection('transactions').doc(transactionId);
        const transactionDoc = await transactionRef.get();
        if (!transactionDoc.exists) {
            throw new https_1.HttpsError('not-found', `Transaction ${transactionId} not found`);
        }
        const transaction = Object.assign({ id: transactionDoc.id }, transactionDoc.data());
        // Verify user owns the transaction
        if (transaction.ownerId !== userId) {
            throw new https_1.HttpsError('permission-denied', 'You can only assign your own transaction splits');
        }
        // Step 2: Get and validate outflow
        const outflowRef = db.collection('outflows').doc(outflowId);
        const outflowDoc = await outflowRef.get();
        if (!outflowDoc.exists) {
            throw new https_1.HttpsError('not-found', `Outflow ${outflowId} not found`);
        }
        const outflow = Object.assign({ id: outflowDoc.id }, outflowDoc.data());
        // Verify user owns the outflow
        if (outflow.userId !== userId) {
            throw new https_1.HttpsError('permission-denied', 'You can only assign splits to your own outflows');
        }
        // Step 3: Find the split in the transaction
        const splits = transaction.splits || [];
        const splitIndex = splits.findIndex(s => s.splitId === splitId);
        if (splitIndex === -1) {
            throw new https_1.HttpsError('not-found', `Split ${splitId} not found in transaction ${transactionId}`);
        }
        const split = splits[splitIndex];
        // Step 4: Check if split is already assigned to an outflow
        if (split.outflowId && split.outflowId !== outflowId) {
            throw new https_1.HttpsError('failed-precondition', 'Split is already assigned to another outflow. Unassign it first.');
        }
        // Step 5: Find all matching outflow periods
        // If targetPeriodId is provided, use it to find overlapping periods (for advance payments)
        // Otherwise, use transaction date to find current periods
        let matchingPeriods;
        if (targetPeriodId) {
            console.log(`[assignSplitToAll] Using target period: ${targetPeriodId}`);
            matchingPeriods = await (0, findMatchingOutflowPeriods_1.findMatchingOutflowPeriodsBySourcePeriod)(db, outflowId, targetPeriodId);
        }
        else {
            console.log(`[assignSplitToAll] Using transaction date: ${transaction.transactionDate.toDate().toISOString()}`);
            matchingPeriods = await (0, findMatchingOutflowPeriods_1.findMatchingOutflowPeriods)(db, outflowId, transaction.transactionDate);
        }
        (0, findMatchingOutflowPeriods_1.validatePeriodsFound)(matchingPeriods);
        console.log(`[assignSplitToAll] Found ${matchingPeriods.foundCount} matching periods`);
        // Step 6: Update the split with ALL outflow period references
        const updatedSplit = Object.assign(Object.assign({}, splits[splitIndex]), { 
            // Clear budget assignment if requested
            budgetId: clearBudgetAssignment ? '' : splits[splitIndex].budgetId, 
            // Set outflow assignment
            outflowId: outflowId, 
            // Payment classification
            paymentType: paymentType, 
            // Payment date (matches transaction date)
            paymentDate: transaction.transactionDate, 
            // Timestamp
            updatedAt: admin.firestore.Timestamp.now() });
        // Step 7: Update transaction document
        splits[splitIndex] = updatedSplit;
        await transactionRef.update({
            splits,
            updatedAt: admin.firestore.Timestamp.now()
        });
        console.log(`[assignSplitToAll] Updated transaction split with all period references`);
        // Step 8: Create TransactionSplitReference for outflow periods
        const splitRef = {
            transactionId: transaction.id,
            splitId: split.splitId,
            transactionDate: transaction.transactionDate,
            amount: split.amount,
            description: transaction.description,
            paymentType: paymentType,
            isAutoMatched: false,
            matchedAt: admin.firestore.Timestamp.now(),
            matchedBy: userId
        };
        // Step 9: Batch update ALL outflow periods with the transaction reference
        const batch = db.batch();
        if (matchingPeriods.monthlyPeriodId) {
            const monthlyRef = db.collection('outflow_periods').doc(matchingPeriods.monthlyPeriodId);
            batch.update(monthlyRef, {
                transactionSplits: admin.firestore.FieldValue.arrayUnion(splitRef),
                updatedAt: admin.firestore.Timestamp.now()
            });
        }
        if (matchingPeriods.weeklyPeriodId) {
            const weeklyRef = db.collection('outflow_periods').doc(matchingPeriods.weeklyPeriodId);
            batch.update(weeklyRef, {
                transactionSplits: admin.firestore.FieldValue.arrayUnion(splitRef),
                updatedAt: admin.firestore.Timestamp.now()
            });
        }
        if (matchingPeriods.biWeeklyPeriodId) {
            const biWeeklyRef = db.collection('outflow_periods').doc(matchingPeriods.biWeeklyPeriodId);
            batch.update(biWeeklyRef, {
                transactionSplits: admin.firestore.FieldValue.arrayUnion(splitRef),
                updatedAt: admin.firestore.Timestamp.now()
            });
        }
        // Step 10: Fetch period documents for status recalculation BEFORE batch commit
        // This allows us to cache the period data and avoid re-reading after the batch update
        const cachedPeriods = {};
        // Fetch all periods in parallel before committing the batch
        const periodFetchPromises = [];
        if (matchingPeriods.monthlyPeriodId) {
            periodFetchPromises.push(db.collection('outflow_periods').doc(matchingPeriods.monthlyPeriodId).get()
                .then(doc => {
                if (doc.exists) {
                    cachedPeriods.monthly = Object.assign({ id: doc.id }, doc.data());
                }
            }));
        }
        if (matchingPeriods.weeklyPeriodId) {
            periodFetchPromises.push(db.collection('outflow_periods').doc(matchingPeriods.weeklyPeriodId).get()
                .then(doc => {
                if (doc.exists) {
                    cachedPeriods.weekly = Object.assign({ id: doc.id }, doc.data());
                }
            }));
        }
        if (matchingPeriods.biWeeklyPeriodId) {
            periodFetchPromises.push(db.collection('outflow_periods').doc(matchingPeriods.biWeeklyPeriodId).get()
                .then(doc => {
                if (doc.exists) {
                    cachedPeriods.biWeekly = Object.assign({ id: doc.id }, doc.data());
                }
            }));
        }
        // Wait for all period fetches to complete
        await Promise.all(periodFetchPromises);
        // Now commit the batch with split references
        await batch.commit();
        console.log(`[assignSplitToAll] Added split reference to ${matchingPeriods.foundCount} outflow periods`);
        // Step 11: Retrieve period documents for response
        let monthlyPeriod;
        let weeklyPeriod;
        let biWeeklyPeriod;
        if (matchingPeriods.monthlyPeriodId && cachedPeriods.monthly) {
            monthlyPeriod = cachedPeriods.monthly;
            // Status is calculated on read, no need to store it
            console.log(`[assignSplitToAll] Monthly period updated`);
        }
        if (matchingPeriods.weeklyPeriodId && cachedPeriods.weekly) {
            weeklyPeriod = cachedPeriods.weekly;
            // Status is calculated on read, no need to store it
            console.log(`[assignSplitToAll] Weekly period updated`);
        }
        if (matchingPeriods.biWeeklyPeriodId && cachedPeriods.biWeekly) {
            biWeeklyPeriod = cachedPeriods.biWeekly;
            // Status is calculated on read, no need to store it
            console.log(`[assignSplitToAll] Bi-weekly period updated`);
        }
        // No status batch needed anymore - status is calculated on read
        console.log(`[assignSplitToAll] Successfully assigned split to ${matchingPeriods.foundCount} periods`);
        const response = {
            success: true,
            split: updatedSplit,
            monthlyPeriod,
            weeklyPeriod,
            biWeeklyPeriod,
            periodsUpdated: matchingPeriods.foundCount,
            message: `Split assigned to ${outflow.description} (${paymentType}) - ${matchingPeriods.foundCount} periods updated`
        };
        return response;
    }
    catch (error) {
        console.error('[assignSplitToAll] Error:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to assign split to outflow periods');
    }
});
//# sourceMappingURL=assignSplitToAllOutflowPeriods.js.map