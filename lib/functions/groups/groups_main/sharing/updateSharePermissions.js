"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSharePermissions = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("../../../../utils/firestore");
// Map resource types to collection names
const RESOURCE_COLLECTIONS = {
    budget: 'budgets',
    transaction: 'transactions',
    outflow: 'outflows',
    inflow: 'inflows',
    rule: 'rules',
};
/**
 * Update permissions for an existing share
 *
 * Only the resource owner can update share permissions.
 * Can update the role and/or fine-grained permissions.
 */
exports.updateSharePermissions = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    console.log('[updateSharePermissions] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const callerUserId = request.auth.uid;
        const { resourceType, resourceId, targetType, targetId, newRole, newPermissions } = request.data;
        // Validate request data
        if (!resourceType || !RESOURCE_COLLECTIONS[resourceType]) {
            throw new https_1.HttpsError('invalid-argument', 'Valid resourceType is required');
        }
        if (!resourceId || typeof resourceId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'resourceId is required');
        }
        if (!targetType || (targetType !== 'group' && targetType !== 'user')) {
            throw new https_1.HttpsError('invalid-argument', 'Valid targetType (group or user) is required');
        }
        if (!targetId || typeof targetId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'targetId is required');
        }
        if (!newRole && !newPermissions) {
            throw new https_1.HttpsError('invalid-argument', 'Either newRole or newPermissions must be provided');
        }
        const collectionName = RESOURCE_COLLECTIONS[resourceType];
        // Get the resource
        const resource = await (0, firestore_1.getDocument)(collectionName, resourceId);
        if (!resource) {
            throw new https_1.HttpsError('not-found', `${resourceType} not found`);
        }
        // Check if caller is the owner
        const ownerId = resource.ownerId || resource.userId || resource.createdBy;
        if (ownerId !== callerUserId) {
            throw new https_1.HttpsError('permission-denied', 'Only the resource owner can update share permissions');
        }
        // Get current sharing configuration
        const currentSharing = resource.sharing || {
            isShared: false,
            sharedWith: [],
            inheritPermissions: true,
        };
        // Find the share entry
        const shareIndex = currentSharing.sharedWith.findIndex(s => s.type === targetType && s.targetId === targetId);
        if (shareIndex === -1) {
            throw new https_1.HttpsError('not-found', 'Share not found');
        }
        // Update the share entry
        if (newRole) {
            currentSharing.sharedWith[shareIndex].role = newRole;
        }
        if (newPermissions) {
            currentSharing.sharedWith[shareIndex].permissions = newPermissions;
        }
        // Update the resource
        await (0, firestore_1.updateDocument)(collectionName, resourceId, {
            sharing: currentSharing,
        });
        console.log('[updateSharePermissions] Share permissions updated successfully');
        return {
            success: true,
            message: 'Share permissions updated successfully',
        };
    }
    catch (error) {
        console.error('[updateSharePermissions] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to update share permissions');
    }
});
//# sourceMappingURL=updateSharePermissions.js.map