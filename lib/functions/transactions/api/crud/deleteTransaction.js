"use strict";
/**
 * Delete Transaction Cloud Function
 *
 * Deletes a transaction and updates budget spending.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTransaction = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
const budgetSpending_1 = require("../../../../utils/budgetSpending");
/**
 * Delete transaction
 */
exports.deleteTransaction = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "DELETE") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only DELETE requests are allowed"));
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
            // Check permissions
            if (existingTransaction.ownerId !== user.id && user.role !== types_1.UserRole.ADMIN) {
                return response.status(403).json((0, auth_1.createErrorResponse)("permission-denied", "Cannot delete this transaction"));
            }
            // Check group access (backward compatible with groupId)
            if (existingTransaction.groupId && !await (0, auth_1.checkFamilyAccess)(user.id, existingTransaction.groupId)) {
                return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this transaction"));
            }
            // Update budget spending (reverse the spending) BEFORE deleting
            try {
                await (0, budgetSpending_1.updateBudgetSpending)({
                    oldTransaction: existingTransaction,
                    newTransaction: undefined, // Indicates deletion
                    userId: user.id,
                    groupId: existingTransaction.groupId
                });
            }
            catch (budgetError) {
                // Log error but don't fail transaction deletion
                console.error('Budget spending update failed before transaction deletion:', budgetError);
            }
            // Delete transaction
            await (0, firestore_1.deleteDocument)("transactions", transactionId);
            return response.status(200).json((0, auth_1.createSuccessResponse)({ deleted: true }));
        }
        catch (error) {
            console.error("Error deleting transaction:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to delete transaction"));
        }
    });
});
//# sourceMappingURL=deleteTransaction.js.map