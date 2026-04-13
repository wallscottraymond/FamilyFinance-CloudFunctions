"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.leaveGroup = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const firestore_2 = require("../../../../utils/firestore");
/**
 * Leave a group (user removes themselves)
 *
 * Any member can leave a group except the owner.
 * Owner must transfer ownership or delete the group instead.
 */
exports.leaveGroup = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    console.log('🚀 [leaveGroup] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const userId = request.auth.uid;
        const { groupId } = request.data;
        // Validate request data
        if (!groupId || typeof groupId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'groupId is required');
        }
        // Get the group
        const group = await (0, firestore_2.getDocument)('groups', groupId);
        if (!group) {
            throw new https_1.HttpsError('not-found', 'Group not found');
        }
        if (!group.isActive) {
            throw new https_1.HttpsError('failed-precondition', 'Group is not active');
        }
        // Find the user's membership
        const userMember = group.members.find(m => m.userId === userId);
        if (!userMember) {
            throw new https_1.HttpsError('not-found', 'You are not a member of this group');
        }
        // Owner cannot leave - must transfer ownership or delete
        if (userMember.role === types_1.GroupRole.OWNER) {
            throw new https_1.HttpsError('failed-precondition', 'Owner cannot leave the group. Transfer ownership or delete the group instead.');
        }
        // Remove the user from the group
        const updatedMembers = group.members.filter(m => m.userId !== userId);
        await (0, firestore_2.updateDocument)('groups', groupId, {
            members: updatedMembers,
        });
        console.log('✅ [leaveGroup] User removed from group');
        // Update the user's groupIds and groupMemberships
        const user = await (0, firestore_2.getDocument)('users', userId);
        if (user && user.groupMemberships) {
            const updatedMemberships = user.groupMemberships.filter(m => m.groupId !== groupId);
            await (0, firestore_2.updateDocument)('users', userId, {
                groupIds: firestore_1.FieldValue.arrayRemove(groupId),
                groupMemberships: updatedMemberships,
            });
            console.log('✅ [leaveGroup] User groupIds updated');
        }
        return {
            success: true,
            message: 'Successfully left the group',
        };
    }
    catch (error) {
        console.error('❌ [leaveGroup] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to leave group');
    }
});
//# sourceMappingURL=leaveGroup.js.map