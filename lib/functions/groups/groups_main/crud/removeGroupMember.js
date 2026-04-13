"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeGroupMember = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const firestore_2 = require("../../../../utils/firestore");
/**
 * Remove a member from a group
 *
 * Only group owners and admins can remove members.
 * Admins cannot remove the owner or other admins.
 * The removed member's groupIds array is updated automatically.
 */
exports.removeGroupMember = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    console.log('🚀 [removeGroupMember] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const callerUserId = request.auth.uid;
        const { groupId, userId: targetUserId } = request.data;
        // Validate request data
        if (!groupId || typeof groupId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'groupId is required');
        }
        if (!targetUserId || typeof targetUserId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'userId is required');
        }
        // Get the group
        const group = await (0, firestore_2.getDocument)('groups', groupId);
        if (!group) {
            throw new https_1.HttpsError('not-found', 'Group not found');
        }
        if (!group.isActive) {
            throw new https_1.HttpsError('failed-precondition', 'Group is not active');
        }
        // Find the caller's membership
        const callerMember = group.members.find(m => m.userId === callerUserId);
        if (!callerMember) {
            throw new https_1.HttpsError('permission-denied', 'You are not a member of this group');
        }
        // Check if caller has permission to remove members (owner or admin only)
        if (callerMember.role !== types_1.GroupRole.OWNER && callerMember.role !== types_1.GroupRole.ADMIN) {
            throw new https_1.HttpsError('permission-denied', 'Only owners and admins can remove members');
        }
        // Find the target member
        const targetMember = group.members.find(m => m.userId === targetUserId);
        if (!targetMember) {
            throw new https_1.HttpsError('not-found', 'User is not a member of this group');
        }
        // Cannot remove the owner
        if (targetMember.role === types_1.GroupRole.OWNER) {
            throw new https_1.HttpsError('permission-denied', 'Cannot remove the group owner. Transfer ownership first.');
        }
        // Admin cannot remove another admin (only owner can)
        if (callerMember.role === types_1.GroupRole.ADMIN && targetMember.role === types_1.GroupRole.ADMIN) {
            throw new https_1.HttpsError('permission-denied', 'Only the owner can remove admins');
        }
        // Remove the member from the group
        const updatedMembers = group.members.filter(m => m.userId !== targetUserId);
        await (0, firestore_2.updateDocument)('groups', groupId, {
            members: updatedMembers,
        });
        console.log('✅ [removeGroupMember] Member removed from group');
        // Update the target user's groupIds and groupMemberships
        // Find the membership to remove
        const targetUser = await (0, firestore_2.getDocument)('users', targetUserId);
        if (targetUser && targetUser.groupMemberships) {
            const updatedMemberships = targetUser.groupMemberships.filter(m => m.groupId !== groupId);
            await (0, firestore_2.updateDocument)('users', targetUserId, {
                groupIds: firestore_1.FieldValue.arrayRemove(groupId),
                groupMemberships: updatedMemberships,
            });
            console.log('✅ [removeGroupMember] User groupIds updated');
        }
        return {
            success: true,
            message: 'Member removed from group',
        };
    }
    catch (error) {
        console.error('❌ [removeGroupMember] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to remove group member');
    }
});
//# sourceMappingURL=removeGroupMember.js.map