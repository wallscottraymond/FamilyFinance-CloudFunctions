"use strict";
/**
 * Get Outflow Period Transactions - Callable Function
 *
 * Retrieve all transactions and splits assigned to an outflow period.
 * Returns enriched data with full transaction details for display in the detail screen.
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
exports.getOutflowPeriodTransactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("../../../utils/auth");
const types_1 = require("../../../types");
const admin = __importStar(require("firebase-admin"));
/**
 * Callable function to get transactions assigned to an outflow period
 */
exports.getOutflowPeriodTransactions = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (request) => {
    var _a, _b;
    try {
        // Authenticate user (VIEWER role required - read only)
        const authResult = await (0, auth_1.authenticateRequest)(request, auth_1.UserRole.VIEWER);
        const userId = authResult.user.uid;
        const { outflowPeriodId } = request.data;
        // Validate required fields
        if (!outflowPeriodId) {
            throw new https_1.HttpsError('invalid-argument', 'outflowPeriodId is required');
        }
        console.log(`[getOutflowPeriodTransactions] User ${userId} requesting transactions for period ${outflowPeriodId}`);
        const db = admin.firestore();
        // Step 1: Get and validate outflow period
        const periodRef = db.collection('outflow_periods').doc(outflowPeriodId);
        const periodDoc = await periodRef.get();
        if (!periodDoc.exists) {
            throw new https_1.HttpsError('not-found', `Outflow period ${outflowPeriodId} not found`);
        }
        const outflowPeriod = Object.assign({ id: periodDoc.id }, periodDoc.data());
        // Verify user owns the outflow period (or is in the same family)
        if (outflowPeriod.ownerId !== userId) {
            // TODO: Check family membership when family feature is implemented
            throw new https_1.HttpsError('permission-denied', 'You can only view your own outflow periods');
        }
        // Step 2: Get transaction IDs from period
        const transactionIds = outflowPeriod.transactionIds || [];
        if (transactionIds.length === 0) {
            console.log(`[getOutflowPeriodTransactions] No transactions assigned to period ${outflowPeriodId}`);
            return {
                success: true,
                outflowPeriod: {
                    id: outflowPeriod.id,
                    outflowDescription: outflowPeriod.description,
                    amountDue: outflowPeriod.totalAmountUnpaid,
                    status: 'pending', // Status should be calculated on read
                    isDuePeriod: outflowPeriod.isDuePeriod,
                    dueDate: outflowPeriod.firstDueDateInPeriod || undefined
                },
                transactions: [],
                summary: {
                    totalPaid: 0,
                    totalRegular: 0,
                    totalCatchUp: 0,
                    totalAdvance: 0,
                    totalExtraPrincipal: 0,
                    transactionCount: 0,
                    splitCount: 0
                },
                message: 'No transactions assigned to this period'
            };
        }
        // Step 3: Fetch full transaction documents
        const enrichedTransactions = [];
        for (const transactionId of transactionIds) {
            try {
                const transactionDoc = await db.collection('transactions').doc(transactionId).get();
                if (!transactionDoc.exists) {
                    console.warn(`[getOutflowPeriodTransactions] Transaction ${transactionId} not found, skipping`);
                    continue;
                }
                const transaction = Object.assign({ id: transactionDoc.id }, transactionDoc.data());
                // Get all splits from this transaction that are assigned to this outflow
                const matchingSplits = transaction.splits.filter(s => s.outflowId === outflowPeriod.outflowId);
                for (const split of matchingSplits) {
                    // Create enriched transaction object
                    enrichedTransactions.push({
                        transaction: {
                            id: transaction.id,
                            amount: split.amount, // Use split amount
                            description: transaction.description,
                            date: transaction.transactionDate,
                            merchantName: (_a = transaction.initialPlaidData) === null || _a === void 0 ? void 0 : _a.plaidMerchantName,
                            category: split.plaidPrimaryCategory, // Use split's category
                            pending: false,
                            accountId: transaction.accountId
                        },
                        split: {
                            id: split.splitId,
                            amount: split.amount,
                            description: (_b = split.description) !== null && _b !== void 0 ? _b : undefined,
                            categoryId: split.plaidPrimaryCategory
                        },
                        splitReference: {
                            transactionId: transaction.id,
                            splitId: split.splitId,
                            transactionDate: transaction.transactionDate,
                            amount: split.amount,
                            description: transaction.description,
                            paymentType: split.paymentType || types_1.PaymentType.REGULAR,
                            isAutoMatched: false,
                            matchedAt: admin.firestore.Timestamp.now(),
                            matchedBy: userId
                        }
                    });
                }
            }
            catch (error) {
                console.error(`[getOutflowPeriodTransactions] Error fetching transaction ${transactionId}:`, error);
            }
        }
        // Step 4: Calculate summary statistics
        const summary = {
            totalPaid: 0,
            totalRegular: 0,
            totalCatchUp: 0,
            totalAdvance: 0,
            totalExtraPrincipal: 0,
            transactionCount: transactionIds.length,
            splitCount: enrichedTransactions.length
        };
        enrichedTransactions.forEach(({ splitReference }) => {
            summary.totalPaid += splitReference.amount;
            switch (splitReference.paymentType) {
                case types_1.PaymentType.REGULAR:
                    summary.totalRegular += splitReference.amount;
                    break;
                case types_1.PaymentType.CATCH_UP:
                    summary.totalCatchUp += splitReference.amount;
                    break;
                case types_1.PaymentType.ADVANCE:
                    summary.totalAdvance += splitReference.amount;
                    break;
                case types_1.PaymentType.EXTRA_PRINCIPAL:
                    summary.totalExtraPrincipal += splitReference.amount;
                    break;
            }
        });
        // Step 5: Sort transactions by date (most recent first)
        enrichedTransactions.sort((a, b) => b.transaction.date.toMillis() - a.transaction.date.toMillis());
        console.log(`[getOutflowPeriodTransactions] Returning ${enrichedTransactions.length} transactions for period ${outflowPeriodId}`);
        const response = {
            success: true,
            outflowPeriod: {
                id: outflowPeriod.id,
                outflowDescription: outflowPeriod.description,
                amountDue: outflowPeriod.totalAmountUnpaid,
                status: 'pending', // Status should be calculated on read
                isDuePeriod: outflowPeriod.isDuePeriod,
                dueDate: outflowPeriod.firstDueDateInPeriod || undefined
            },
            transactions: enrichedTransactions,
            summary,
            message: `Found ${enrichedTransactions.length} transaction(s)`
        };
        return response;
    }
    catch (error) {
        console.error('[getOutflowPeriodTransactions] Error:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to get outflow period transactions');
    }
});
//# sourceMappingURL=getOutflowPeriodTransactions.js.map