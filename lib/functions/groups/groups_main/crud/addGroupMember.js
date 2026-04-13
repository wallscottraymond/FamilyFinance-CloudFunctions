"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addGroupMember = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const firestore_2 = require("../../../../utils/firestore");
/**
 * Add a member to a group
 *
 * Only group owners and admins can add members.
 * The new member's groupIds array is updated automatically.
 */
exports.addGroupMember = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    console.log('🚀 [addGroupMember] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const callerUserId = request.auth.uid;
        const { groupId, userId: targetUserId, role } = request.data;
        // Validate request data
        if (!groupId || typeof groupId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'groupId is required');
        }
        if (!targetUserId || typeof targetUserId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'userId is required');
        }
        if (!role || !Object.values(types_1.GroupRole).includes(role)) {
            throw new https_1.HttpsError('invalid-argument', 'Valid role is required (owner, admin, editor, viewer)');
        }
        // Cannot add someone as owner directly
        if (role === types_1.GroupRole.OWNER) {
            throw new https_1.HttpsError('invalid-argument', 'Cannot add a member as owner. Use transferOwnership instead.');
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
        // Check if caller has permission to add members (owner or admin only)
        if (callerMember.role !== types_1.GroupRole.OWNER && callerMember.role !== types_1.GroupRole.ADMIN) {
            throw new https_1.HttpsError('permission-denied', 'Only owners and admins can add members');
        }
        // Admin cannot add another admin (only owner can)
        if (callerMember.role === types_1.GroupRole.ADMIN && role === types_1.GroupRole.ADMIN) {
            throw new https_1.HttpsError('permission-denied', 'Only the owner can add admins');
        }
        // Check if target user exists
        const targetUser = await (0, firestore_2.getDocument)('users', targetUserId);
        if (!targetUser) {
            throw new https_1.HttpsError('not-found', 'Target user not found');
        }
        // Check if target user is already a member
        const existingMember = group.members.find(m => m.userId === targetUserId);
        if (existingMember) {
            throw new https_1.HttpsError('already-exists', 'User is already a member of this group');
        }
        // Check member limit
        if (group.members.length >= group.settings.maxMembers) {
            throw new https_1.HttpsError('resource-exhausted', `Group has reached maximum members (${group.settings.maxMembers})`);
        }
        // Create the new member entry
        const newMember = {
            userId: targetUserId,
            role,
            joinedAt: firestore_1.Timestamp.now(),
            invitedBy: callerUserId,
            status: 'active',
        };
        // Update the group with the new member
        const updatedMembers = [...group.members, newMember];
        await (0, firestore_2.updateDocument)('groups', groupId, {
            members: updatedMembers,
        });
        console.log('✅ [addGroupMember] Member added to group');
        // Update the target user's groupIds and groupMemberships
        const userMembership = {
            groupId,
            role,
            joinedAt: firestore_1.Timestamp.now(),
            invitedBy: callerUserId,
            status: 'active',
        };
        await (0, firestore_2.updateDocument)('users', targetUserId, {
            groupIds: firestore_1.FieldValue.arrayUnion(groupId),
            groupMemberships: firestore_1.FieldValue.arrayUnion(userMembership),
        });
        console.log('✅ [addGroupMember] User groupIds updated');
        return {
            success: true,
            message: `User added to group as ${role}`,
        };
    }
    catch (error) {
        console.error('❌ [addGroupMember] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to add group member');
    }
});
//# sourceMappingURL=addGroupMember.js.map