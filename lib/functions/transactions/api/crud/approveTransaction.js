"use strict";
/**
 * Approve Transaction Cloud Function
 *
 * Approves or rejects a pending transaction.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
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
exports.approveTransaction = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const admin = __importStar(require("firebase-admin"));
const cors_1 = require("../../../../middleware/cors");
const index_1 = require("../../../../index");
/**
 * Approve or reject transaction
 */
exports.approveTransaction = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "POST") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only POST requests are allowed"));
        }
        try {
            const transactionId = request.query.id;
            const action = request.body.action; // "approve" or "reject"
            if (!transactionId || !action) {
                return response.status(400).json((0, auth_1.createErrorResponse)("missing-parameters", "Transaction ID and action are required"));
            }
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.EDITOR);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Get transaction
            const transaction = await (0, firestore_1.getDocument)("transactions", transactionId);
            if (!transaction) {
                return response.status(404).json((0, auth_1.createErrorResponse)("transaction-not-found", "Transaction not found"));
            }
            // Check group access (backward compatible with familyId)
            if (transaction.groupId && !await (0, auth_1.checkFamilyAccess)(user.id, transaction.groupId)) {
                return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this transaction"));
            }
            // Check if transaction is pending
            if (transaction.transactionStatus !== types_1.TransactionStatus.PENDING) {
                return response.status(400).json((0, auth_1.createErrorResponse)("invalid-status", "Transaction is not pending approval"));
            }
            // Update transaction status
            const newStatus = action === "approve" ? types_1.TransactionStatus.APPROVED : types_1.TransactionStatus.REJECTED;
            // Get the transaction first to update metadata
            const transactionRef = index_1.db.collection('transactions').doc(transactionId);
            await transactionRef.update({
                status: newStatus,
                'metadata.approvedBy': user.id,
                'metadata.approvedAt': admin.firestore.Timestamp.now(),
                updatedAt: admin.firestore.Timestamp.now()
            });
            const updatedDoc = await transactionRef.get();
            const updatedTransaction = Object.assign({ id: updatedDoc.id }, updatedDoc.data());
            return response.status(200).json((0, auth_1.createSuccessResponse)(updatedTransaction));
        }
        catch (error) {
            console.error("Error approving transaction:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to update transaction status"));
        }
    });
});
//# sourceMappingURL=approveTransaction.js.map