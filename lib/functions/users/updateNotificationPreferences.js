"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateNotificationPreferences = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../types");
const firestore_1 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Update user notification preferences
 */
exports.updateNotificationPreferences = (0, https_1.onRequest)({
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
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            const notifications = request.body.notifications;
            if (!notifications || typeof notifications !== "object") {
                return response.status(400).json((0, auth_1.createErrorResponse)("invalid-data", "Notification preferences are required"));
            }
            // Update notification preferences
            const updatedUser = await (0, firestore_1.updateDocument)("users", user.id, {
                preferences: Object.assign(Object.assign({}, user.preferences), { notifications: Object.assign(Object.assign({}, user.preferences.notifications), notifications) }),
            });
            return response.status(200).json((0, auth_1.createSuccessResponse)(updatedUser.preferences.notifications));
        }
        catch (error) {
            console.error("Error updating notification preferences:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to update notification preferences"));
        }
    });
});
//# sourceMappingURL=updateNotificationPreferences.js.map