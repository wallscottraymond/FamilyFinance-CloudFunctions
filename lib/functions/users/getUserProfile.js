"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserProfile = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../types");
const firestore_1 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Get user profile
 */
exports.getUserProfile = (0, https_1.onRequest)({
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
            // Check if user can access target user's profile
            if (targetUserId !== user.id) {
                const hasAccess = await (0, auth_1.checkUserAccess)(user.id, targetUserId);
                if (!hasAccess) {
                    return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this user's profile"));
                }
            }
            // Get user profile
            const userProfile = await (0, firestore_1.getDocument)("users", targetUserId);
            if (!userProfile) {
                return response.status(404).json((0, auth_1.createErrorResponse)("user-not-found", "User profile not found"));
            }
            return response.status(200).json((0, auth_1.createSuccessResponse)(userProfile));
        }
        catch (error) {
            console.error("Error getting user profile:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get user profile"));
        }
    });
});
//# sourceMappingURL=getUserProfile.js.map