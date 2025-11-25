"use strict";
/**
 * Update Transaction Cloud Function
 *
 * Updates an existing transaction.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTransaction = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const cors_1 = require("../../../../middleware/cors");
const budgetSpending_1 = require("../../../../utils/budgetSpending");
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
            // Update transaction
            const updatedTransaction = await (0, firestore_1.updateDocument)("transactions", transactionId, updateData);
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