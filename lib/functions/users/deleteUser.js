"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteUser = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../types");
const firestore_1 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Delete user account
 */
exports.deleteUser = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "DELETE") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only DELETE requests are allowed"));
        }
        try {
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Only users can delete their own accounts, or admin can delete any account
            const targetUserId = request.query.userId || user.id;
            if (targetUserId !== user.id && user.role !== types_1.UserRole.ADMIN) {
                return response.status(403).json((0, auth_1.createErrorResponse)("permission-denied", "Cannot delete this user account"));
            }
            // Check if user is family admin
            if (user.familyId && user.role === types_1.UserRole.ADMIN) {
                // Get family to check if this is the only admin
                const family = await (0, firestore_1.getDocument)("families", user.familyId);
                if (family && family.adminUserId === user.id) {
                    // Check if there are other family members
                    if (family.memberIds.length > 1) {
                        return response.status(400).json((0, auth_1.createErrorResponse)("cannot-delete-admin", "Cannot delete account while being the only family admin. Transfer admin role first."));
                    }
                }
            }
            // Soft delete - mark as inactive instead of hard delete for data integrity
            await (0, firestore_1.updateDocument)("users", targetUserId, {
                isActive: false,
                email: `deleted_${Date.now()}_${user.email}`,
            });
            // Optionally, delete from Firebase Auth (uncomment if hard delete is required)
            // await deleteUserAccount(targetUserId);
            return response.status(200).json((0, auth_1.createSuccessResponse)({ deleted: true }));
        }
        catch (error) {
            console.error("Error deleting user account:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to delete user account"));
        }
    });
});
//# sourceMappingURL=deleteUser.js.map