"use strict";
/**
 * Debug Transaction Matching - Admin Function
 *
 * Helps debug why transactions aren't being matched to outflow periods.
 * Checks:
 * - What transaction IDs are stored in the outflow
 * - Whether those documents exist in the transactions collection
 * - What the actual document IDs are
 *
 * Usage: GET /debugTransactionMatching?outflowId=OUTFLOW_ID
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
exports.debugTransactionMatching = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
exports.debugTransactionMatching = (0, https_1.onRequest)({
    memory: '256MiB',
    timeoutSeconds: 60,
}, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    try {
        const { outflowId } = req.query;
        if (!outflowId || typeof outflowId !== 'string') {
            res.status(400).json({ error: 'outflowId query parameter is required' });
            return;
        }
        const db = admin.firestore();
        // Get the outflow document
        const outflowDoc = await db.collection('outflows').doc(outflowId).get();
        if (!outflowDoc.exists) {
            res.status(404).json({ error: `Outflow ${outflowId} not found` });
            return;
        }
        const outflowData = outflowDoc.data();
        const transactionIds = (outflowData === null || outflowData === void 0 ? void 0 : outflowData.transactionIds) || [];
        console.log(`[debugTransactionMatching] Outflow ${outflowId} has ${transactionIds.length} transaction IDs`);
        // Check each transaction ID
        const results = [];
        for (const txnId of transactionIds) {
            console.log(`[debugTransactionMatching] Checking transaction ID: ${txnId}`);
            // Try to fetch transaction directly by ID
            const txnDoc = await db.collection('transactions').doc(txnId).get();
            if (txnDoc.exists) {
                const txnData = txnDoc.data();
                results.push({
                    plaidTransactionId: txnId,
                    documentExists: true,
                    documentId: txnDoc.id,
                    userId: txnData === null || txnData === void 0 ? void 0 : txnData.userId,
                    amount: txnData === null || txnData === void 0 ? void 0 : txnData.amount,
                    description: txnData === null || txnData === void 0 ? void 0 : txnData.description,
                    date: (_a = txnData === null || txnData === void 0 ? void 0 : txnData.date) === null || _a === void 0 ? void 0 : _a.toDate(),
                    splits: ((_b = txnData === null || txnData === void 0 ? void 0 : txnData.splits) === null || _b === void 0 ? void 0 : _b.length) || 0,
                    metadata: {
                        plaidTransactionId: (_c = txnData === null || txnData === void 0 ? void 0 : txnData.metadata) === null || _c === void 0 ? void 0 : _c.plaidTransactionId,
                        source: (_d = txnData === null || txnData === void 0 ? void 0 : txnData.metadata) === null || _d === void 0 ? void 0 : _d.source
                    }
                });
            }
            else {
                // Try to find by metadata.plaidTransactionId
                const querySnapshot = await db.collection('transactions')
                    .where('metadata.plaidTransactionId', '==', txnId)
                    .where('userId', '==', outflowData === null || outflowData === void 0 ? void 0 : outflowData.userId)
                    .limit(1)
                    .get();
                if (!querySnapshot.empty) {
                    const foundDoc = querySnapshot.docs[0];
                    const foundData = foundDoc.data();
                    results.push({
                        plaidTransactionId: txnId,
                        documentExists: false,
                        foundViaQuery: true,
                        documentId: foundDoc.id,
                        userId: foundData.userId,
                        amount: foundData.amount,
                        description: foundData.description,
                        date: (_e = foundData.date) === null || _e === void 0 ? void 0 : _e.toDate(),
                        splits: ((_f = foundData.splits) === null || _f === void 0 ? void 0 : _f.length) || 0,
                        metadata: {
                            plaidTransactionId: (_g = foundData.metadata) === null || _g === void 0 ? void 0 : _g.plaidTransactionId,
                            source: (_h = foundData.metadata) === null || _h === void 0 ? void 0 : _h.source
                        },
                        issue: 'Transaction ID in outflow.transactionIds does not match document ID'
                    });
                }
                else {
                    results.push({
                        plaidTransactionId: txnId,
                        documentExists: false,
                        foundViaQuery: false,
                        issue: 'Transaction not found in database at all'
                    });
                }
            }
        }
        // Get summary statistics
        const summary = {
            totalTransactionIds: transactionIds.length,
            foundAsDocumentId: results.filter(r => r.documentExists).length,
            foundViaQuery: results.filter(r => r.foundViaQuery).length,
            notFound: results.filter(r => !r.documentExists && !r.foundViaQuery).length
        };
        res.status(200).json({
            outflowId,
            outflowDescription: (outflowData === null || outflowData === void 0 ? void 0 : outflowData.description) || (outflowData === null || outflowData === void 0 ? void 0 : outflowData.merchantName),
            userId: outflowData === null || outflowData === void 0 ? void 0 : outflowData.userId,
            summary,
            transactionDetails: results,
            diagnosis: summary.foundViaQuery > 0
                ? '⚠️ ISSUE FOUND: Transaction IDs in outflow.transactionIds do not match document IDs. Old transactions may have been created with auto-generated IDs instead of Plaid transaction IDs.'
                : summary.foundAsDocumentId === summary.totalTransactionIds
                    ? '✅ ALL GOOD: All transaction IDs match document IDs correctly'
                    : '❌ MISSING TRANSACTIONS: Some transactions do not exist in database'
        });
    }
    catch (error) {
        console.error('[debugTransactionMatching] Error:', error);
        res.status(500).json({
            error: error.message || 'Failed to debug transaction matching',
            stack: error.stack
        });
    }
});
//# sourceMappingURL=debugTransactionMatching.js.map