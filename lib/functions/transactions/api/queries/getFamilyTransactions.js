"use strict";
/**
 * Get Family Transactions Cloud Function
 *
 * Retrieves all transactions for a family.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFamilyTransactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Get family transactions
 */
exports.getFamilyTransactions = (0, https_1.onRequest)({
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
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.EDITOR);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            if (!user.familyId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-family", "User must belong to a family"));
            }
            const limit = parseInt(request.query.limit) || 100;
            const offset = parseInt(request.query.offset) || 0;
            // Query all family transactions
            const transactions = await (0, firestore_1.queryDocuments)("transactions", {
                where: [
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
            console.error("Error getting family transactions:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get family transactions"));
        }
    });
});
//# sourceMappingURL=getFamilyTransactions.js.map