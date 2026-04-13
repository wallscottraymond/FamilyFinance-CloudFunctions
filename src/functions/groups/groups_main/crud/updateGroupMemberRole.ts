import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  Group,
  GroupRole,
  User,
  UpdateGroupMemberRoleRequest,
  UpdateGroupMemberRoleResponse,
} from "../../../../types";
import {
  getDocument,
  updateDocument,
} from "../../../../utils/firestore";

/**
 * Update a member's role within a group
 *
 * Only group owners can promote/demote to admin.
 * Admins can promote/demote editors and viewers.
 * Cannot change owner's role (use transferOwnership instead).
 */
export const updateGroupMemberRole = onCall<UpdateGroupMemberRoleRequest, Promise<UpdateGroupMemberRoleResponse>>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  console.log('🚀 [updateGroupMemberRole] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const callerUserId = request.auth.uid;
    const { groupId, userId: targetUserId, newRole } = request.data;

    // Validate request data
    if (!groupId || typeof groupId !== 'string') {
      throw new HttpsError('invalid-argument', 'groupId is required');
    }

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new HttpsError('invalid-argument', 'userId is required');
    }

    if (!newRole || !Object.values(GroupRole).includes(newRole)) {
      throw new HttpsError('invalid-argument', 'Valid newRole is required (admin, editor, viewer)');
    }

    // Cannot set role to owner
    if (newRole === GroupRole.OWNER) {
      throw new HttpsError('invalid-argument', 'Cannot set role to owner. Use transferOwnership instead.');
    }

    // Get the group
    const group = await getDocument<Group>('groups', groupId);
    if (!group) {
      throw new HttpsError('not-found', 'Group not found');
    }

    if (!group.isActive) {
      throw new HttpsError('failed-precondition', 'Group is not active');
    }

    // Find the caller's membership
    const callerMember = group.members.find(m => m.userId === callerUserId);
    if (!callerMember) {
      throw new HttpsError('permission-denied', 'You are not a member of this group');
    }

    // Check if caller has permission to update roles (owner or admin only)
    if (callerMember.role !== GroupRole.OWNER && callerMember.role !== GroupRole.ADMIN) {
      throw new HttpsError('permission-denied', 'Only owners and admins can update member roles');
    }

    // Find the target member
    const targetMemberIndex = group.members.findIndex(m => m.userId === targetUserId);
    if (targetMemberIndex === -1) {
      throw new HttpsError('not-found', 'User is not a member of this group');
    }

    const targetMember = group.members[targetMemberIndex];

    // Cannot change owner's role
    if (targetMember.role === GroupRole.OWNER) {
      throw new HttpsError('permission-denied', 'Cannot change owner role. Use transferOwnership instead.');
    }

    // Admin cannot promote to admin or demote from admin (only owner can)
    if (callerMember.role === GroupRole.ADMIN) {
      if (targetMember.role === GroupRole.ADMIN || newRole === GroupRole.ADMIN) {
        throw new HttpsError('permission-denied', 'Only the owner can promote to or demote from admin');
      }
    }

    // No change needed
    if (targetMember.role === newRole) {
      return {
        success: true,
        message: `User already has role ${newRole}`,
      };
    }

    // Update the member's role in the group
    const updatedMembers = [...group.members];
    updatedMembers[targetMemberIndex] = {
      ...targetMember,
      role: newRole,
    };

    await updateDocument<Group>('groups', groupId, {
      members: updatedMembers,
    });

    console.log('✅ [updateGroupMemberRole] Member role updated in group');

    // Update the target user's groupMemberships
    const targetUser = await getDocument<User>('users', targetUserId);
    if (targetUser && targetUser.groupMemberships) {
      const updatedMemberships = targetUser.groupMemberships.map(m => {
        if (m.groupId === groupId) {
          return {
            ...m,
            role: newRole,
          };
        }
        return m;
      });

      await updateDocument<User>('users', targetUserId, {
        groupMemberships: updatedMemberships,
      });

      console.log('✅ [updateGroupMemberRole] User groupMemberships updated');
    }

    return {
      success: true,
      message: `Member role updated to ${newRole}`,
    };

  } catch (error: any) {
    console.error('❌ [updateGroupMemberRole] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to update member role');
  }
});
