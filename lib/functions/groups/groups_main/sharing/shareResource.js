"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shareResource = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const firestore_2 = require("../../../../utils/firestore");
// Map resource types to collection names
const RESOURCE_COLLECTIONS = {
    budget: 'budgets',
    transaction: 'transactions',
    outflow: 'outflows',
    inflow: 'inflows',
    rule: 'rules',
};
/**
 * Share a resource with a user or group
 *
 * Only the resource owner can share resources.
 * When sharing with a group, adds the groupId to the resource's groupIds array.
 */
exports.shareResource = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    console.log('[shareResource] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const callerUserId = request.auth.uid;
        const { resourceType, resourceId, shareWith } = request.data;
        // Validate request data
        if (!resourceType || !RESOURCE_COLLECTIONS[resourceType]) {
            throw new https_1.HttpsError('invalid-argument', 'Valid resourceType is required');
        }
        if (!resourceId || typeof resourceId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'resourceId is required');
        }
        if (!shareWith || !shareWith.type || !shareWith.targetId || !shareWith.role) {
            throw new https_1.HttpsError('invalid-argument', 'shareWith with type, targetId, and role is required');
        }
        const collectionName = RESOURCE_COLLECTIONS[resourceType];
        // Get the resource
        const resource = await (0, firestore_2.getDocument)(collectionName, resourceId);
        if (!resource) {
            throw new https_1.HttpsError('not-found', `${resourceType} not found`);
        }
        // Check if caller is the owner
        const ownerId = resource.ownerId || resource.userId || resource.createdBy;
        if (ownerId !== callerUserId) {
            throw new https_1.HttpsError('permission-denied', 'Only the resource owner can share resources');
        }
        // If sharing with a group, verify the group exists and caller is a member
        if (shareWith.type === 'group') {
            const group = await (0, firestore_2.getDocument)('groups', shareWith.targetId);
            if (!group) {
                throw new https_1.HttpsError('not-found', 'Group not found');
            }
            if (!group.isActive) {
                throw new https_1.HttpsError('failed-precondition', 'Group is not active');
            }
            // Verify caller is a member of the group
            const callerMember = group.members.find(m => m.userId === callerUserId);
            if (!callerMember) {
                throw new https_1.HttpsError('permission-denied', 'You must be a member of the group to share with it');
            }
            // Only owners and admins can share with groups
            if (callerMember.role !== types_1.GroupRole.OWNER && callerMember.role !== types_1.GroupRole.ADMIN) {
                throw new https_1.HttpsError('permission-denied', 'Only group owners and admins can share resources with the group');
            }
        }
        // Build the new share entry
        const newShare = {
            type: shareWith.type,
            targetId: shareWith.targetId,
            role: shareWith.role,
            sharedBy: callerUserId,
            sharedAt: firestore_1.Timestamp.now(),
            permissions: shareWith.permissions,
        };
        // Get or initialize the sharing configuration
        const currentSharing = resource.sharing || {
            isShared: false,
            sharedWith: [],
            inheritPermissions: true,
        };
        // Check if already shared with this target
        const existingShareIndex = currentSharing.sharedWith.findIndex(s => s.type === shareWith.type && s.targetId === shareWith.targetId);
        if (existingShareIndex !== -1) {
            // Update existing share
            currentSharing.sharedWith[existingShareIndex] = newShare;
        }
        else {
            // Add new share
            currentSharing.sharedWith.push(newShare);
        }
        currentSharing.isShared = currentSharing.sharedWith.length > 0;
        // Build update object
        const updateData = {
            sharing: currentSharing,
        };
        // If sharing with a group, also add to groupIds array
        if (shareWith.type === 'group') {
            const currentGroupIds = resource.groupIds || [];
            if (!currentGroupIds.includes(shareWith.targetId)) {
                updateData.groupIds = [...currentGroupIds, shareWith.targetId];
            }
        }
        // Update the resource
        await (0, firestore_2.updateDocument)(collectionName, resourceId, updateData);
        console.log('[shareResource] Resource shared successfully');
        return {
            success: true,
            message: `${resourceType} shared successfully`,
        };
    }
    catch (error) {
        console.error('[shareResource] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to share resource');
    }
});
//# sourceMappingURL=shareResource.js.map