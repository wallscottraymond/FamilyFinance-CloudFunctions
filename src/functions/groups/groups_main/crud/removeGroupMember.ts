import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import {
  Group,
  GroupRole,
  User,
  RemoveGroupMemberRequest,
  RemoveGroupMemberResponse,
} from "../../../../types";
import {
  getDocument,
  updateDocument,
} from "../../../../utils/firestore";

/**
 * Remove a member from a group
 *
 * Only group owners and admins can remove members.
 * Admins cannot remove the owner or other admins.
 * The removed member's groupIds array is updated automatically.
 */
export const removeGroupMember = onCall<RemoveGroupMemberRequest, Promise<RemoveGroupMemberResponse>>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  console.log('🚀 [removeGroupMember] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const callerUserId = request.auth.uid;
    const { groupId, userId: targetUserId } = request.data;

    // Validate request data
    if (!groupId || typeof groupId !== 'string') {
      throw new HttpsError('invalid-argument', 'groupId is required');
    }

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new HttpsError('invalid-argument', 'userId is required');
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

    // Check if caller has permission to remove members (owner or admin only)
    if (callerMember.role !== GroupRole.OWNER && callerMember.role !== GroupRole.ADMIN) {
      throw new HttpsError('permission-denied', 'Only owners and admins can remove members');
    }

    // Find the target member
    const targetMember = group.members.find(m => m.userId === targetUserId);
    if (!targetMember) {
      throw new HttpsError('not-found', 'User is not a member of this group');
    }

    // Cannot remove the owner
    if (targetMember.role === GroupRole.OWNER) {
      throw new HttpsError('permission-denied', 'Cannot remove the group owner. Transfer ownership first.');
    }

    // Admin cannot remove another admin (only owner can)
    if (callerMember.role === GroupRole.ADMIN && targetMember.role === GroupRole.ADMIN) {
      throw new HttpsError('permission-denied', 'Only the owner can remove admins');
    }

    // Remove the member from the group
    const updatedMembers = group.members.filter(m => m.userId !== targetUserId);
    await updateDocument<Group>('groups', groupId, {
      members: updatedMembers,
    });

    console.log('✅ [removeGroupMember] Member removed from group');

    // Update the target user's groupIds and groupMemberships
    // Find the membership to remove
    const targetUser = await getDocument<User>('users', targetUserId);
    if (targetUser && targetUser.groupMemberships) {
      const updatedMemberships = targetUser.groupMemberships.filter(
        m => m.groupId !== groupId
      );

      await updateDocument<User>('users', targetUserId, {
        groupIds: FieldValue.arrayRemove(groupId) as unknown as string[],
        groupMemberships: updatedMemberships,
      });

      console.log('✅ [removeGroupMember] User groupIds updated');
    }

    return {
      success: true,
      message: 'Member removed from group',
    };

  } catch (error: any) {
    console.error('❌ [removeGroupMember] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to remove group member');
  }
});
