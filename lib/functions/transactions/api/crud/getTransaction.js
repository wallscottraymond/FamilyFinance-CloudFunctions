"use strict";
/**
 * Get Transaction Cloud Function
 *
 * Retrieves a single transaction by ID.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransaction = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Get transaction by ID
 */
exports.getTransaction = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "GET") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only GET requests are allowed"));
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
            // Get transaction
            const transaction = await (0, firestore_1.getDocument)("transactions", transactionId);
            if (!transaction) {
                return response.status(404).json((0, auth_1.createErrorResponse)("transaction-not-found", "Transaction not found"));
            }
            // Check if user can access this transaction
            if (transaction.groupId && !await (0, auth_1.checkFamilyAccess)(user.id, transaction.groupId)) {
                return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this transaction"));
            }
            return response.status(200).json((0, auth_1.createSuccessResponse)(transaction));
        }
        catch (error) {
            console.error("Error getting transaction:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get transaction"));
        }
    });
});
//# sourceMappingURL=getTransaction.js.map