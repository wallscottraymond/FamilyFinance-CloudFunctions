import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  Group,
  GroupRole,
  User,
  TransferGroupOwnershipRequest,
  TransferGroupOwnershipResponse,
} from "../../../../types";
import {
  getDocument,
  updateDocument,
} from "../../../../utils/firestore";

/**
 * Transfer group ownership to another member
 *
 * Only the current owner can transfer ownership.
 * The new owner must be an existing member of the group.
 * The previous owner is demoted to admin.
 */
export const transferGroupOwnership = onCall<TransferGroupOwnershipRequest, Promise<TransferGroupOwnershipResponse>>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  console.log('[transferGroupOwnership] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const callerUserId = request.auth.uid;
    const { groupId, newOwnerId } = request.data;

    // Validate request data
    if (!groupId || typeof groupId !== 'string') {
      throw new HttpsError('invalid-argument', 'groupId is required');
    }

    if (!newOwnerId || typeof newOwnerId !== 'string') {
      throw new HttpsError('invalid-argument', 'newOwnerId is required');
    }

    // Cannot transfer to self
    if (newOwnerId === callerUserId) {
      throw new HttpsError('invalid-argument', 'Cannot transfer ownership to yourself');
    }

    // Get the group
    const group = await getDocument<Group>('groups', groupId);
    if (!group) {
      throw new HttpsError('not-found', 'Group not found');
    }

    if (!group.isActive) {
      throw new HttpsError('failed-precondition', 'Group is not active');
    }

    // Verify caller is the current owner
    const callerMember = group.members.find(m => m.userId === callerUserId);
    if (!callerMember) {
      throw new HttpsError('permission-denied', 'You are not a member of this group');
    }

    if (callerMember.role !== GroupRole.OWNER) {
      throw new HttpsError('permission-denied', 'Only the group owner can transfer ownership');
    }

    // Verify new owner is a member
    const newOwnerMemberIndex = group.members.findIndex(m => m.userId === newOwnerId);
    if (newOwnerMemberIndex === -1) {
      throw new HttpsError('not-found', 'New owner must be an existing member of the group');
    }

    const callerMemberIndex = group.members.findIndex(m => m.userId === callerUserId);

    // Update the members array
    const updatedMembers = [...group.members];

    // Demote current owner to admin
    updatedMembers[callerMemberIndex] = {
      ...updatedMembers[callerMemberIndex],
      role: GroupRole.ADMIN,
    };

    // Promote new owner
    updatedMembers[newOwnerMemberIndex] = {
      ...updatedMembers[newOwnerMemberIndex],
      role: GroupRole.OWNER,
    };

    // Update the group document
    await updateDocument<Group>('groups', groupId, {
      ownerId: newOwnerId,
      members: updatedMembers,
    });

    console.log('[transferGroupOwnership] Group ownership transferred');

    // Update the previous owner's groupMemberships
    const previousOwnerUser = await getDocument<User>('users', callerUserId);
    if (previousOwnerUser && previousOwnerUser.groupMemberships) {
      const updatedMemberships = previousOwnerUser.groupMemberships.map(m => {
        if (m.groupId === groupId) {
          return {
            ...m,
            role: GroupRole.ADMIN,
          };
        }
        return m;
      });

      await updateDocument<User>('users', callerUserId, {
        groupMemberships: updatedMemberships,
      });

      console.log('[transferGroupOwnership] Previous owner groupMemberships updated');
    }

    // Update the new owner's groupMemberships
    const newOwnerUser = await getDocument<User>('users', newOwnerId);
    if (newOwnerUser && newOwnerUser.groupMemberships) {
      const updatedMemberships = newOwnerUser.groupMemberships.map(m => {
        if (m.groupId === groupId) {
          return {
            ...m,
            role: GroupRole.OWNER,
          };
        }
        return m;
      });

      await updateDocument<User>('users', newOwnerId, {
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

  } catch (error: any) {
    console.error('[transferGroupOwnership] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to transfer group ownership');
  }
});
