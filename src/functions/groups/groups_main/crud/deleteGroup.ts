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

// Request/Response types for deleteGroup
interface DeleteGroupRequest {
  groupId: string;
  confirm: boolean; // Require explicit confirmation
}

interface DeleteGroupResponse {
  success: boolean;
  message?: string;
}

/**
 * Delete a group (soft delete by setting isActive to false)
 *
 * Only the group owner can delete a group.
 * All members' groupIds arrays are updated automatically.
 */
export const deleteGroup = onCall<DeleteGroupRequest, Promise<DeleteGroupResponse>>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 60, // Longer timeout for member cleanup
}, async (request) => {
  console.log('🚀 [deleteGroup] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    const { groupId, confirm } = request.data;

    // Validate request data
    if (!groupId || typeof groupId !== 'string') {
      throw new HttpsError('invalid-argument', 'groupId is required');
    }

    if (confirm !== true) {
      throw new HttpsError('invalid-argument', 'Deletion must be explicitly confirmed');
    }

    // Get the group
    const group = await getDocument<Group>('groups', groupId);
    if (!group) {
      throw new HttpsError('not-found', 'Group not found');
    }

    if (!group.isActive) {
      throw new HttpsError('failed-precondition', 'Group is already deleted');
    }

    // Find the user's membership
    const userMember = group.members.find(m => m.userId === userId);
    if (!userMember) {
      throw new HttpsError('permission-denied', 'You are not a member of this group');
    }

    // Only owner can delete the group
    if (userMember.role !== GroupRole.OWNER) {
      throw new HttpsError('permission-denied', 'Only the group owner can delete the group');
    }

    // Soft delete the group (set isActive to false)
    await updateDocument<Group>('groups', groupId, {
      isActive: false,
    });

    console.log('✅ [deleteGroup] Group marked as deleted');

    // Update all members' groupIds and groupMemberships
    const memberUpdatePromises = group.members.map(async (member) => {
      try {
        const memberUser = await getDocument<User>('users', member.userId);
        if (memberUser && memberUser.groupMemberships) {
          const updatedMemberships = memberUser.groupMemberships.filter(
            m => m.groupId !== groupId
          );

          await updateDocument<User>('users', member.userId, {
            groupIds: FieldValue.arrayRemove(groupId) as unknown as string[],
            groupMemberships: updatedMemberships,
          });

          console.log(`✅ [deleteGroup] Updated groupIds for user: ${member.userId}`);
        }
      } catch (err) {
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

  } catch (error: any) {
    console.error('❌ [deleteGroup] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to delete group');
  }
});
