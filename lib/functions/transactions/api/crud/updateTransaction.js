"use strict";
/**
 * Update Transaction Cloud Function
 *
 * Updates an existing transaction.
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
exports.updateTransaction = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const admin = __importStar(require("firebase-admin"));
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const cors_1 = require("../../../../middleware/cors");
const budgetSpending_1 = require("../../../../utils/budgetSpending");
const validateBudgetIds_1 = require("../../utils/validateBudgetIds");
const matchTransactionSplitsToBudgets_1 = require("../../utils/matchTransactionSplitsToBudgets");
/**
 * Update transaction
 */
exports.updateTransaction = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "PUT") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only PUT requests are allowed"));
        }
        try {
            const transactionId = request.query.id;
            if (!transactionId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("missing-parameter", "Transaction ID is required"));
            }
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Get existing transaction
            const existingTransaction = await (0, firestore_1.getDocument)("transactions", transactionId);
            if (!existingTransaction) {
                return response.status(404).json((0, auth_1.createErrorResponse)("transaction-not-found", "Transaction not found"));
            }
            // Check permissions - user can edit their own transactions or admin can edit any
            if (existingTransaction.ownerId !== user.id && user.role !== types_1.UserRole.ADMIN) {
                return response.status(403).json((0, auth_1.createErrorResponse)("permission-denied", "Cannot edit this transaction"));
            }
            // Check group access (backward compatible with groupId)
            if (existingTransaction.groupId && !await (0, auth_1.checkFamilyAccess)(user.id, existingTransaction.groupId)) {
                return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this transaction"));
            }
            // Validate request body
            const validation = (0, validation_1.validateRequest)(request.body, validation_1.updateTransactionSchema);
            if (validation.error) {
                return response.status(400).json((0, auth_1.createErrorResponse)("validation-error", validation.error));
            }
            const updateData = validation.value;
            // Phase 1 & 2: Validate and reassign splits if they're being updated
            if (updateData.splits && updateData.splits.length > 0) {
                console.log(`[updateTransaction] Validating and reassigning ${updateData.splits.length} splits`);
                // Step 1: Validate and auto-fix budgetIds
                updateData.splits = await (0, validateBudgetIds_1.validateAndFixBudgetIds)(user.id, updateData.splits);
                // Step 2: Reassign splits based on current categories and budget rules
                // Create a temporary transaction object for the matcher
                const tempTransaction = Object.assign(Object.assign(Object.assign({}, existingTransaction), updateData), { splits: updateData.splits, transactionDate: updateData.transactionDate
                        ? (typeof updateData.transactionDate === 'string'
                            ? admin.firestore.Timestamp.fromDate(new Date(updateData.transactionDate))
                            : updateData.transactionDate)
                        : existingTransaction.transactionDate });
                // Call matcher to reassign budgetIds
                const reassignedTransactions = await (0, matchTransactionSplitsToBudgets_1.matchTransactionSplitsToBudgets)([tempTransaction], user.id);
                updateData.splits = reassignedTransactions[0].splits;
                console.log(`[updateTransaction] Splits reassigned - budgetIds: ${updateData.splits.map(s => s.budgetId).join(', ')}`);
            }
            // Convert transactionDate string to Timestamp if needed
            const updateDataForFirestore = Object.assign({}, updateData);
            if (updateData.transactionDate && typeof updateData.transactionDate === 'string') {
                updateDataForFirestore.transactionDate = admin.firestore.Timestamp.fromDate(new Date(updateData.transactionDate));
            }
            // Update transaction
            const updatedTransaction = await (0, firestore_1.updateDocument)("transactions", transactionId, updateDataForFirestore);
            // Update budget spending based on transaction changes
            try {
                await (0, budgetSpending_1.updateBudgetSpending)({
                    oldTransaction: existingTransaction,
                    newTransaction: updatedTransaction,
                    userId: user.id,
                    groupId: existingTransaction.groupId
                });
            }
            catch (budgetError) {
                // Log error but don't fail transaction update
                console.error('Budget spending update failed after transaction update:', budgetError);
            }
            return response.status(200).json((0, auth_1.createSuccessResponse)(updatedTransaction));
        }
        catch (error) {
            console.error("Error updating transaction:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to update transaction"));
        }
    });
});
//# sourceMappingURL=updateTransaction.js.map