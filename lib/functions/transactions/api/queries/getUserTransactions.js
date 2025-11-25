"use strict";
/**
 * Get User Transactions Cloud Function
 *
 * Retrieves transactions for a specific user.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserTransactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Get user transactions
 */
exports.getUserTransactions = (0, https_1.onRequest)({
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
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            const targetUserId = request.query.userId || user.id;
            const limit = parseInt(request.query.limit) || 50;
            const offset = parseInt(request.query.offset) || 0;
            // Check if user can access target user's transactions
            if (targetUserId !== user.id && user.role === types_1.UserRole.VIEWER) {
                return response.status(403).json((0, auth_1.createErrorResponse)("permission-denied", "Cannot access other user's transactions"));
            }
            if (!user.familyId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-family", "User must belong to a family"));
            }
            // Query transactions
            const transactions = await (0, firestore_1.queryDocuments)("transactions", {
                where: [
                    { field: "userId", operator: "==", value: targetUserId },
                    { field: "familyId", operator: "==", value: user.familyId },
                ],
                orderBy: "createdAt",
                orderDirection: "desc",
                limit,
                offset,
            });
            return response.status(200).json((0, auth_1.createSuccessResponse)(transactions));
        }
        catch (error) {
            console.error("Error getting user transactions:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get transactions"));
        }
    });
});
//# sourceMappingURL=getUserTransactions.js.map