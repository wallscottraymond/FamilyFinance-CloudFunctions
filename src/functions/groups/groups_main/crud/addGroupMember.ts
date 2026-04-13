import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import {
  Group,
  GroupRole,
  GroupMember,
  User,
  AddGroupMemberRequest,
  AddGroupMemberResponse,
  GroupMembership,
} from "../../../../types";
import {
  getDocument,
  updateDocument,
} from "../../../../utils/firestore";

/**
 * Add a member to a group
 *
 * Only group owners and admins can add members.
 * The new member's groupIds array is updated automatically.
 */
export const addGroupMember = onCall<AddGroupMemberRequest, Promise<AddGroupMemberResponse>>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  console.log('🚀 [addGroupMember] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const callerUserId = request.auth.uid;
    const { groupId, userId: targetUserId, role } = request.data;

    // Validate request data
    if (!groupId || typeof groupId !== 'string') {
      throw new HttpsError('invalid-argument', 'groupId is required');
    }

    if (!targetUserId || typeof targetUserId !== 'string') {
      throw new HttpsError('invalid-argument', 'userId is required');
    }

    if (!role || !Object.values(GroupRole).includes(role)) {
      throw new HttpsError('invalid-argument', 'Valid role is required (owner, admin, editor, viewer)');
    }

    // Cannot add someone as owner directly
    if (role === GroupRole.OWNER) {
      throw new HttpsError('invalid-argument', 'Cannot add a member as owner. Use transferOwnership instead.');
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

    // Check if caller has permission to add members (owner or admin only)
    if (callerMember.role !== GroupRole.OWNER && callerMember.role !== GroupRole.ADMIN) {
      throw new HttpsError('permission-denied', 'Only owners and admins can add members');
    }

    // Admin cannot add another admin (only owner can)
    if (callerMember.role === GroupRole.ADMIN && role === GroupRole.ADMIN) {
      throw new HttpsError('permission-denied', 'Only the owner can add admins');
    }

    // Check if target user exists
    const targetUser = await getDocument<User>('users', targetUserId);
    if (!targetUser) {
      throw new HttpsError('not-found', 'Target user not found');
    }

    // Check if target user is already a member
    const existingMember = group.members.find(m => m.userId === targetUserId);
    if (existingMember) {
      throw new HttpsError('already-exists', 'User is already a member of this group');
    }

    // Check member limit
    if (group.members.length >= group.settings.maxMembers) {
      throw new HttpsError('resource-exhausted', `Group has reached maximum members (${group.settings.maxMembers})`);
    }

    // Create the new member entry
    const newMember: GroupMember = {
      userId: targetUserId,
      role,
      joinedAt: Timestamp.now(),
      invitedBy: callerUserId,
      status: 'active',
    };

    // Update the group with the new member
    const updatedMembers = [...group.members, newMember];
    await updateDocument<Group>('groups', groupId, {
      members: updatedMembers,
    });

    console.log('✅ [addGroupMember] Member added to group');

    // Update the target user's groupIds and groupMemberships
    const userMembership: GroupMembership = {
      groupId,
      role,
      joinedAt: Timestamp.now(),
      invitedBy: callerUserId,
      status: 'active',
    };

    await updateDocument<User>('users', targetUserId, {
      groupIds: FieldValue.arrayUnion(groupId) as unknown as string[],
      groupMemberships: FieldValue.arrayUnion(userMembership) as unknown as GroupMembership[],
    });

    console.log('✅ [addGroupMember] User groupIds updated');

    return {
      success: true,
      message: `User added to group as ${role}`,
    };

  } catch (error: any) {
    console.error('❌ [addGroupMember] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to add group member');
  }
});
