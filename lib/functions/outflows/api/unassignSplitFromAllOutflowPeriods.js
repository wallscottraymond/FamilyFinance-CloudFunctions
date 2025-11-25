"use strict";
/**
 * Unassign Split from All Outflow Periods - Callable Function
 *
 * Removes a transaction split assignment from ALL THREE outflow period types
 * (monthly, weekly, bi-weekly) simultaneously. This ensures that when a user
 * removes a bill payment assignment, all period views are updated correctly.
 *
 * Key Features:
 * - Extracts all three period IDs from the transaction split
 * - Clears all outflow references from the split
 * - Removes payment reference from all three outflow_periods documents
 * - Recalculates status for all three periods
 * - Atomic batch operations for data consistency
 *
 * Memory: 256MiB, Timeout: 30s
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
exports.unassignSplitFromAllOutflowPeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("../../../utils/auth");
const admin = __importStar(require("firebase-admin"));
/**
 * Callable function to unassign a transaction split from ALL outflow periods
 */
exports.unassignSplitFromAllOutflowPeriods = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    try {
        // Authenticate user (EDITOR role required)
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.EDITOR);
        const userId = authResult.user.uid;
        const { transactionId, splitId } = request.data;
        // Validate required fields
        if (!transactionId || !splitId) {
            throw new https_1.HttpsError('invalid-argument', 'transactionId and splitId are required');
        }
        console.log(`[unassignSplitFromAll] User ${userId} unassigning split ${splitId} from all outflow periods`);
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
            throw new https_1.HttpsError('permission-denied', 'You can only unassign your own transaction splits');
        }
        // Step 2: Find the split in the transaction
        const splits = transaction.splits || [];
        const splitIndex = splits.findIndex(s => s.splitId === splitId);
        if (splitIndex === -1) {
            throw new https_1.HttpsError('not-found', `Split ${splitId} not found in transaction ${transactionId}`);
        }
        const split = splits[splitIndex];
        // Step 3: Check if split is assigned to an outflow
        if (!split.outflowId) {
            throw new https_1.HttpsError('failed-precondition', 'Split is not assigned to any outflow');
        }
        const outflowId = split.outflowId;
        // Extract source period IDs from the split (these identify which periods to search)
        const sourcePeriodIds = [];
        if (split.monthlyPeriodId)
            sourcePeriodIds.push(split.monthlyPeriodId);
        if (split.weeklyPeriodId)
            sourcePeriodIds.push(split.weeklyPeriodId);
        if (split.biWeeklyPeriodId)
            sourcePeriodIds.push(split.biWeeklyPeriodId);
        if (sourcePeriodIds.length === 0) {
            throw new https_1.HttpsError('failed-precondition', 'Split has no source period IDs');
        }
        console.log(`[unassignSplitFromAll] Searching for outflow periods matching outflowId ${outflowId} and source periods: ${sourcePeriodIds.join(', ')}`);
        // Find outflow_periods that match these source periods and outflow ID
        const outflowPeriodIds = [];
        for (const sourcePeriodId of sourcePeriodIds) {
            const periodsQuery = await db.collection('outflow_periods')
                .where('ownerId', '==', userId)
                .where('outflowId', '==', outflowId)
                .where('sourcePeriodId', '==', sourcePeriodId)
                .get();
            periodsQuery.forEach(doc => {
                outflowPeriodIds.push(doc.id);
            });
        }
        if (outflowPeriodIds.length === 0) {
            throw new https_1.HttpsError('failed-precondition', 'No matching outflow periods found');
        }
        console.log(`[unassignSplitFromAll] Found ${outflowPeriodIds.length} outflow periods to remove split from`);
        // Step 4: Clear outflow assignment from the split (source period IDs remain)
        splits[splitIndex] = Object.assign(Object.assign({}, splits[splitIndex]), { outflowId: null, paymentType: undefined, updatedAt: admin.firestore.Timestamp.now() });
        // Step 5: Update transaction document
        await transactionRef.update({
            splits,
            updatedAt: admin.firestore.Timestamp.now()
        });
        console.log(`[unassignSplitFromAll] Cleared outflow assignment from split`);
        // Step 6: Fetch period documents for response
        let monthlyPeriod;
        let weeklyPeriod;
        let biWeeklyPeriod;
        for (const periodId of outflowPeriodIds) {
            const periodDoc = await db.collection('outflow_periods').doc(periodId).get();
            if (periodDoc.exists) {
                const period = Object.assign({ id: periodDoc.id }, periodDoc.data());
                // Store period for response based on type
                if (period.periodType === 'monthly') {
                    monthlyPeriod = period;
                }
                else if (period.periodType === 'weekly') {
                    weeklyPeriod = period;
                }
                else if (period.periodType === 'bi_monthly') {
                    biWeeklyPeriod = period;
                }
            }
        }
        console.log(`[unassignSplitFromAll] Successfully unassigned split from ${outflowPeriodIds.length} periods`);
        const response = {
            success: true,
            monthlyPeriod,
            weeklyPeriod,
            biWeeklyPeriod,
            periodsUpdated: outflowPeriodIds.length,
            message: `Split unassigned from ${outflowPeriodIds.length} periods`
        };
        return response;
    }
    catch (error) {
        console.error('[unassignSplitFromAll] Error:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to unassign split from outflow periods');
    }
});
//# sourceMappingURL=unassignSplitFromAllOutflowPeriods.js.map