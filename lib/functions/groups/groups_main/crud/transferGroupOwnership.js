"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transferGroupOwnership = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
/**
 * Transfer group ownership to another member
 *
 * Only the current owner can transfer ownership.
 * The new owner must be an existing member of the group.
 * The previous owner is demoted to admin.
 */
exports.transferGroupOwnership = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
}, async (request) => {
    console.log('[transferGroupOwnership] Function called with data:', JSON.stringify(request.data, null, 2));
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        const callerUserId = request.auth.uid;
        const { groupId, newOwnerId } = request.data;
        // Validate request data
        if (!groupId || typeof groupId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'groupId is required');
        }
        if (!newOwnerId || typeof newOwnerId !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'newOwnerId is required');
        }
        // Cannot transfer to self
        if (newOwnerId === callerUserId) {
            throw new https_1.HttpsError('invalid-argument', 'Cannot transfer ownership to yourself');
        }
        // Get the group
        const group = await (0, firestore_1.getDocument)('groups', groupId);
        if (!group) {
            throw new https_1.HttpsError('not-found', 'Group not found');
        }
        if (!group.isActive) {
            throw new https_1.HttpsError('failed-precondition', 'Group is not active');
        }
        // Verify caller is the current owner
        const callerMember = group.members.find(m => m.userId === callerUserId);
        if (!callerMember) {
            throw new https_1.HttpsError('permission-denied', 'You are not a member of this group');
        }
        if (callerMember.role !== types_1.GroupRole.OWNER) {
            throw new https_1.HttpsError('permission-denied', 'Only the group owner can transfer ownership');
        }
        // Verify new owner is a member
        const newOwnerMemberIndex = group.members.findIndex(m => m.userId === newOwnerId);
        if (newOwnerMemberIndex === -1) {
            throw new https_1.HttpsError('not-found', 'New owner must be an existing member of the group');
        }
        const callerMemberIndex = group.members.findIndex(m => m.userId === callerUserId);
        // Update the members array
        const updatedMembers = [...group.members];
        // Demote current owner to admin
        updatedMembers[callerMemberIndex] = Object.assign(Object.assign({}, updatedMembers[callerMemberIndex]), { role: types_1.GroupRole.ADMIN });
        // Promote new owner
        updatedMembers[newOwnerMemberIndex] = Object.assign(Object.assign({}, updatedMembers[newOwnerMemberIndex]), { role: types_1.GroupRole.OWNER });
        // Update the group document
        await (0, firestore_1.updateDocument)('groups', groupId, {
            ownerId: newOwnerId,
            members: updatedMembers,
        });
        console.log('[transferGroupOwnership] Group ownership transferred');
        // Update the previous owner's groupMemberships
        const previousOwnerUser = await (0, firestore_1.getDocument)('users', callerUserId);
        if (previousOwnerUser && previousOwnerUser.groupMemberships) {
            const updatedMemberships = previousOwnerUser.groupMemberships.map(m => {
                if (m.groupId === groupId) {
                    return Object.assign(Object.assign({}, m), { role: types_1.GroupRole.ADMIN });
                }
                return m;
            });
            await (0, firestore_1.updateDocument)('users', callerUserId, {
                groupMemberships: updatedMemberships,
            });
            console.log('[transferGroupOwnership] Previous owner groupMemberships updated');
        }
        // Update the new owner's groupMemberships
        const newOwnerUser = await (0, firestore_1.getDocument)('users', newOwnerId);
        if (newOwnerUser && newOwnerUser.groupMemberships) {
            const updatedMemberships = newOwnerUser.groupMemberships.map(m => {
                if (m.groupId === groupId) {
                    return Object.assign(Object.assign({}, m), { role: types_1.GroupRole.OWNER });
                }
                return m;
            });
            await (0, firestore_1.updateDocument)('users', newOwnerId, {
                groupMemberships: updatedMemberships,
            });
            console.log('[transferGroupOwnership] New owner groupMemberships updated');
        }
        return {
            success: true,
            message: 'Group ownership transferred successfully',
            previousOwnerId: callerUserId,
            newOwnerId: newOwnerId,
        };
    }
    catch (error) {
        console.error('[transferGroupOwnership] Error:', error);
        if (error.code && error.message) {
            throw error;
        }
        throw new https_1.HttpsError('internal', 'Failed to transfer group ownership');
    }
});
//# sourceMappingURL=transferGroupOwnership.js.map