"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUserRole = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../types");
const firestore_1 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Update user role (admin only)
 */
exports.updateUserRole = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "PUT") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only PUT requests are allowed"));
        }
        try {
            // Authenticate user (only admin can update roles)
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.ADMIN);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user: adminUser } = authResult;
            const { userId, newRole } = request.body;
            if (!userId || !newRole) {
                return response.status(400).json((0, auth_1.createErrorResponse)("missing-parameters", "User ID and new role are required"));
            }
            // Validate new role
            if (!Object.values(types_1.UserRole).includes(newRole)) {
                return response.status(400).json((0, auth_1.createErrorResponse)("invalid-role", "Invalid user role"));
            }
            if (!adminUser.familyId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-family", "Admin must belong to a family"));
            }
            // Get target user
            const targetUser = await (0, firestore_1.getDocument)("users", userId);
            if (!targetUser) {
                return response.status(404).json((0, auth_1.createErrorResponse)("user-not-found", "User not found"));
            }
            // Check if target user is in the same family
            if (targetUser.familyId !== adminUser.familyId) {
                return response.status(403).json((0, auth_1.createErrorResponse)("different-family", "Can only update roles for family members"));
            }
            // Cannot change own role
            if (targetUser.id === adminUser.id) {
                return response.status(400).json((0, auth_1.createErrorResponse)("cannot-change-own-role", "Cannot change your own role"));
            }
            // Update user role
            const updatedUser = await (0, firestore_1.updateDocument)("users", userId, {
                role: newRole,
            });
            // Update custom claims
            await (0, auth_1.setUserClaims)(userId, {
                role: newRole,
                familyId: targetUser.familyId,
            });
            // Force token refresh for the target user
            await (0, auth_1.revokeUserTokens)(userId);
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                userId,
                oldRole: targetUser.role,
                newRole,
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    displayName: updatedUser.displayName,
                    role: updatedUser.role,
                },
            }));
        }
        catch (error) {
            console.error("Error updating user role:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to update user role"));
        }
    });
});
//# sourceMappingURL=updateUserRole.js.map