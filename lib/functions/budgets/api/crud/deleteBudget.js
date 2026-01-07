"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteBudget = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
/**
 * Delete budget
 */
exports.deleteBudget = (0, https_1.onRequest)({
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
            const budgetId = request.query.id;
            if (!budgetId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("missing-parameter", "Budget ID is required"));
            }
            // Authenticate user (minimum VIEWER role - ownership checked next)
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Get existing budget to check ownership
            const existingBudget = await (0, firestore_1.getDocument)("budgets", budgetId);
            if (!existingBudget) {
                return response.status(404).json((0, auth_1.createErrorResponse)("budget-not-found", "Budget not found"));
            }
            // Check permissions: OWNER always allowed, OR EDITOR/ADMIN role
            const isOwner = existingBudget.createdBy === user.id;
            const isEditor = user.role === types_1.UserRole.EDITOR || user.role === types_1.UserRole.ADMIN;
            if (!isOwner && !isEditor) {
                return response.status(403).json((0, auth_1.createErrorResponse)("permission-denied", "Cannot delete this budget - you must be the owner or have editor role"));
            }
            // Check access - for individual budgets check ownership, for shared budgets check family access
            if (existingBudget.isShared && existingBudget.familyId) {
                // Shared budget - check family access
                if (!await (0, auth_1.checkFamilyAccess)(user.id, existingBudget.familyId)) {
                    return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot access this family budget"));
                }
            }
            else {
                // Individual budget - check ownership
                if (existingBudget.createdBy !== user.id) {
                    return response.status(403).json((0, auth_1.createErrorResponse)("access-denied", "Cannot delete budget created by another user"));
                }
            }
            // CRITICAL: Prevent deletion of "everything else" budget
            if (existingBudget.isSystemEverythingElse) {
                return response.status(400).json((0, auth_1.createErrorResponse)("cannot-delete-system-budget", 'The "Everything Else" budget is a system budget and cannot be deleted'));
            }
            // Soft delete - mark as inactive
            await (0, firestore_1.updateDocument)("budgets", budgetId, { isActive: false });
            return response.status(200).json((0, auth_1.createSuccessResponse)({ deleted: true }));
        }
        catch (error) {
            console.error("Error deleting budget:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to delete budget"));
        }
    });
});
//# sourceMappingURL=deleteBudget.js.map