"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteGroup = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const firestore_2 = require("../../../../utils/firestore");
/**
 * Delete a group (soft delete by setting isActive to false)
 *
 * Only the group owner can delete a group.
 * All members' groupIds arrays are updated automatically.
 */
exports.deleteGroup = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60, // Longer timeout for member cleanup
}, async (request) => {
    console.log('🚀 [deleteGroup] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const userId = request.auth.uid;
        const { groupId, confirm } = request.data;
        // Validate request data
        if (!groupId || typeof groupId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'groupId is required');
        }
        if (confirm !== true) {
            throw new https_1.HttpsError('invalid-argument', 'Deletion must be explicitly confirmed');
        }
        // Get the group
        const group = await (0, firestore_2.getDocument)('groups', groupId);
        if (!group) {
            throw new https_1.HttpsError('not-found', 'Group not found');
        }
        if (!group.isActive) {
            throw new https_1.HttpsError('failed-precondition', 'Group is already deleted');
        }
        // Find the user's membership
        const userMember = group.members.find(m => m.userId === userId);
        if (!userMember) {
            throw new https_1.HttpsError('permission-denied', 'You are not a member of this group');
        }
        // Only owner can delete the group
        if (userMember.role !== types_1.GroupRole.OWNER) {
            throw new https_1.HttpsError('permission-denied', 'Only the group owner can delete the group');
        }
        // Soft delete the group (set isActive to false)
        await (0, firestore_2.updateDocument)('groups', groupId, {
            isActive: false,
        });
        console.log('✅ [deleteGroup] Group marked as deleted');
        // Update all members' groupIds and groupMemberships
        const memberUpdatePromises = group.members.map(async (member) => {
            try {
                const memberUser = await (0, firestore_2.getDocument)('users', member.userId);
                if (memberUser && memberUser.groupMemberships) {
                    const updatedMemberships = memberUser.groupMemberships.filter(m => m.groupId !== groupId);
                    await (0, firestore_2.updateDocument)('users', member.userId, {
                        groupIds: firestore_1.FieldValue.arrayRemove(groupId),
                        groupMemberships: updatedMemberships,
                    });
                    console.log(`✅ [deleteGroup] Updated groupIds for user: ${member.userId}`);
                }
            }
            catch (err) {
                // Log but don't fail - user might have been deleted
                console.warn(`⚠️ [deleteGroup] Failed to update user ${member.userId}:`, err);
            }
        });
        await Promise.all(memberUpdatePromises);
        console.log('✅ [deleteGroup] All member groupIds updated');
        return {
            success: true,
            message: 'Group deleted successfully',
        };
    }
    catch (error) {
        console.error('❌ [deleteGroup] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to delete group');
    }
});
//# sourceMappingURL=deleteGroup.js.map