"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserPermissions = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../types");
const firestore_1 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
const cors_1 = require("../../middleware/cors");
/**
 * Get user permissions for current family
 */
exports.getUserPermissions = (0, https_1.onRequest)({
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
            // Define permissions based on role
            const rolePermissions = {
                [types_1.UserRole.ADMIN]: {
                    canCreateTransactions: true,
                    canEditAllTransactions: true,
                    canDeleteAllTransactions: true,
                    canApproveTransactions: true,
                    canCreateBudgets: true,
                    canEditAllBudgets: true,
                    canViewAllTransactions: true,
                    canManageFamily: true,
                    canInviteMembers: true,
                    canRemoveMembers: true,
                    canChangeRoles: true,
                    canViewReports: true,
                },
                [types_1.UserRole.EDITOR]: {
                    canCreateTransactions: true,
                    canEditOwnTransactions: true,
                    canDeleteOwnTransactions: true,
                    canApproveTransactions: true,
                    canCreateBudgets: true,
                    canEditOwnBudgets: true,
                    canViewAllTransactions: true,
                    canManageFamily: false,
                    canInviteMembers: true,
                    canRemoveMembers: false,
                    canChangeRoles: false,
                    canViewReports: true,
                },
                [types_1.UserRole.VIEWER]: {
                    canCreateTransactions: false,
                    canEditOwnTransactions: false,
                    canDeleteOwnTransactions: false,
                    canApproveTransactions: false,
                    canCreateBudgets: false,
                    canEditOwnBudgets: false,
                    canViewOwnTransactions: true,
                    canManageFamily: false,
                    canInviteMembers: false,
                    canRemoveMembers: false,
                    canChangeRoles: false,
                    canViewReports: false,
                },
            };
            // Get family settings if user belongs to a family
            let familySettings = null;
            if (user.familyId) {
                const family = await (0, firestore_1.getDocument)("families", user.familyId);
                familySettings = (family === null || family === void 0 ? void 0 : family.settings) || null;
            }
            const permissions = rolePermissions[user.role];
            // Adjust permissions based on family settings
            if (familySettings) {
                // If children transactions are disabled, override child permissions
                if (!familySettings.allowViewerTransactions && user.role === types_1.UserRole.VIEWER) {
                    permissions.canCreateTransactions = false;
                }
            }
            return response.status(200).json((0, auth_1.createSuccessResponse)({
                userId: user.id,
                role: user.role,
                familyId: user.familyId,
                permissions,
                familySettings,
            }));
        }
        catch (error) {
            console.error("Error getting user permissions:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get user permissions"));
        }
    });
});
//# sourceMappingURL=getUserPermissions.js.map