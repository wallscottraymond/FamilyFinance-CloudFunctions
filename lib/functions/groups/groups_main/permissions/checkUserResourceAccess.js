"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkUserResourceAccess = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
// Map resource types to collection names
const RESOURCE_COLLECTIONS = {
    budget: 'budgets',
    transaction: 'transactions',
    outflow: 'outflows',
    inflow: 'inflows',
    rule: 'rules',
};
// Map permissions to minimum required role
const PERMISSION_ROLES = {
    read: [types_1.ResourceRole.VIEWER, types_1.ResourceRole.EDITOR, types_1.ResourceRole.OWNER],
    edit: [types_1.ResourceRole.EDITOR, types_1.ResourceRole.OWNER],
    delete: [types_1.ResourceRole.OWNER],
    share: [types_1.ResourceRole.OWNER],
};
/**
 * Check if a user has access to a specific resource
 *
 * Checks:
 * 1. If user is the owner
 * 2. If user has direct share access
 * 3. If user is a member of a group that has access
 */
exports.checkUserResourceAccess = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    console.log('[checkUserResourceAccess] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const { userId, resourceType, resourceId, requiredPermission } = request.data;
        // Validate request data
        if (!userId || typeof userId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'userId is required');
        }
        if (!resourceType || !RESOURCE_COLLECTIONS[resourceType]) {
            throw new https_1.HttpsError('invalid-argument', 'Valid resourceType is required');
        }
        if (!resourceId || typeof resourceId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'resourceId is required');
        }
        if (!requiredPermission || !PERMISSION_ROLES[requiredPermission]) {
            throw new https_1.HttpsError('invalid-argument', 'Valid requiredPermission is required (read, edit, delete, share)');
        }
        const collectionName = RESOURCE_COLLECTIONS[resourceType];
        // Get the resource
        const resource = await (0, firestore_1.getDocument)(collectionName, resourceId);
        if (!resource) {
            return {
                hasAccess: false,
                reason: 'Resource not found',
            };
        }
        // Check if user is the owner
        const ownerId = resource.ownerId || resource.userId || resource.createdBy;
        if (ownerId === userId) {
            return {
                hasAccess: true,
                accessLevel: types_1.ResourceRole.OWNER,
                reason: 'User is the resource owner',
            };
        }
        // Get the user's group memberships
        const user = await (0, firestore_1.getDocument)('users', userId);
        const userGroupIds = (user === null || user === void 0 ? void 0 : user.groupIds) || [];
        // Get current sharing configuration
        const currentSharing = resource.sharing || {
            isShared: false,
            sharedWith: [],
            inheritPermissions: true,
        };
        if (!currentSharing.isShared || currentSharing.sharedWith.length === 0) {
            return {
                hasAccess: false,
                reason: 'Resource is not shared',
            };
        }
        // Check for direct user share
        const userShare = currentSharing.sharedWith.find(s => s.type === 'user' && s.targetId === userId);
        if (userShare) {
            const allowedRoles = PERMISSION_ROLES[requiredPermission];
            const hasPermission = allowedRoles.includes(userShare.role);
            return {
                hasAccess: hasPermission,
                accessLevel: userShare.role,
                reason: hasPermission
                    ? `User has direct ${userShare.role} access`
                    : `User's ${userShare.role} role does not have ${requiredPermission} permission`,
            };
        }
        // Check for group share
        for (const share of currentSharing.sharedWith) {
            if (share.type === 'group' && userGroupIds.includes(share.targetId)) {
                const allowedRoles = PERMISSION_ROLES[requiredPermission];
                const hasPermission = allowedRoles.includes(share.role);
                return {
                    hasAccess: hasPermission,
                    accessLevel: share.role,
                    reason: hasPermission
                        ? `User has ${share.role} access via group membership`
                        : `Group's ${share.role} role does not have ${requiredPermission} permission`,
                };
            }
        }
        return {
            hasAccess: false,
            reason: 'User does not have access to this resource',
        };
    }
    catch (error) {
        console.error('[checkUserResourceAccess] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to check resource access');
    }
});
//# sourceMappingURL=checkUserResourceAccess.js.map