import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import {
  Group,
  GroupRole,
  User,
} from "../../../../types";
import {
  getDocument,
  updateDocument,
} from "../../../../utils/firestore";

// Request/Response types for leaveGroup
interface LeaveGroupRequest {
  groupId: string;
}

interface LeaveGroupResponse {
  success: boolean;
  message?: string;
}

/**
 * Leave a group (user removes themselves)
 *
 * Any member can leave a group except the owner.
 * Owner must transfer ownership or delete the group instead.
 */
export const leaveGroup = onCall<LeaveGroupRequest, Promise<LeaveGroupResponse>>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  console.log('🚀 [leaveGroup] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    const { groupId } = request.data;

    // Validate request data
    if (!groupId || typeof groupId !== 'string') {
      throw new HttpsError('invalid-argument', 'groupId is required');
    }

    // Get the group
    const group = await getDocument<Group>('groups', groupId);
    if (!group) {
      throw new HttpsError('not-found', 'Group not found');
    }

    if (!group.isActive) {
      throw new HttpsError('failed-precondition', 'Group is not active');
    }

    // Find the user's membership
    const userMember = group.members.find(m => m.userId === userId);
    if (!userMember) {
      throw new HttpsError('not-found', 'You are not a member of this group');
    }

    // Owner cannot leave - must transfer ownership or delete
    if (userMember.role === GroupRole.OWNER) {
      throw new HttpsError(
        'failed-precondition',
        'Owner cannot leave the group. Transfer ownership or delete the group instead.'
      );
    }

    // Remove the user from the group
    const updatedMembers = group.members.filter(m => m.userId !== userId);
    await updateDocument<Group>('groups', groupId, {
      members: updatedMembers,
    });

    console.log('✅ [leaveGroup] User removed from group');

    // Update the user's groupIds and groupMemberships
    const user = await getDocument<User>('users', userId);
    if (user && user.groupMemberships) {
      const updatedMemberships = user.groupMemberships.filter(
        m => m.groupId !== groupId
      );

      await updateDocument<User>('users', userId, {
        groupIds: FieldValue.arrayRemove(groupId) as unknown as string[],
        groupMemberships: updatedMemberships,
      });

      console.log('✅ [leaveGroup] User groupIds updated');
    }

    return {
      success: true,
      message: 'Successfully left the group',
    };

  } catch (error: any) {
    console.error('❌ [leaveGroup] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to leave group');
  }
});
