import { onCall, HttpsError } from "firebase-functions/v2/https";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import {
  Group,
  GroupRole,
  GroupMember,
  GroupSettings,
  User,
  CreateGroupRequest,
  CreateGroupResponse,
  GroupMembership,
} from "../../../../types";
import {
  createDocument,
  getDocument,
  updateDocument,
} from "../../../../utils/firestore";

// Default group settings
const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  allowMemberInvites: false,
  requireApprovalForSharing: false,
  defaultResourceRole: GroupRole.VIEWER,
  maxMembers: 50,
};

/**
 * Create a new group
 *
 * The user creating the group becomes the owner.
 * Group ID is added to the user's groupIds array.
 */
export const createGroup = onCall<CreateGroupRequest, Promise<CreateGroupResponse>>({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request) => {
  console.log('🚀 [createGroup] Function called with data:', JSON.stringify(request.data, null, 2));

  try {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;

    // Get user document to verify they exist and check system role
    const userDoc = await getDocument<User>('users', userId);
    if (!userDoc) {
      throw new HttpsError('not-found', 'User profile not found');
    }

    // Check if user is a demo user (cannot create groups)
    if (userDoc.systemRole === 'demo_user') {
      throw new HttpsError('permission-denied', 'Demo users cannot create groups');
    }

    // Validate request data
    const { name, description, settings } = request.data;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'Group name is required');
    }

    if (name.length > 100) {
      throw new HttpsError('invalid-argument', 'Group name must be 100 characters or less');
    }

    if (description && description.length > 500) {
      throw new HttpsError('invalid-argument', 'Description must be 500 characters or less');
    }

    // Build group settings (merge with defaults)
    const groupSettings: GroupSettings = {
      ...DEFAULT_GROUP_SETTINGS,
      ...settings,
    };

    // Validate settings
    if (groupSettings.maxMembers < 2 || groupSettings.maxMembers > 100) {
      throw new HttpsError('invalid-argument', 'maxMembers must be between 2 and 100');
    }

    // Create the owner member entry
    const ownerMember: GroupMember = {
      userId,
      role: GroupRole.OWNER,
      joinedAt: Timestamp.now(),
      invitedBy: userId, // Owner invited themselves
      status: 'active',
    };

    // Build the group document
    const groupDoc: Omit<Group, "id" | "createdAt" | "updatedAt"> = {
      name: name.trim(),
      description: description?.trim(),
      createdBy: userId,
      ownerId: userId,
      members: [ownerMember],
      settings: groupSettings,
      isActive: true,
    };

    // Create the group document
    const createdGroup = await createDocument<Group>("groups", groupDoc);
    console.log('✅ [createGroup] Group created:', createdGroup.id);

    // Add the group to the user's groupIds array and groupMemberships
    const userMembership: GroupMembership = {
      groupId: createdGroup.id!,
      role: GroupRole.OWNER,
      joinedAt: Timestamp.now(),
      invitedBy: userId,
      status: 'active',
    };

    await updateDocument<User>('users', userId, {
      groupIds: FieldValue.arrayUnion(createdGroup.id!) as unknown as string[],
      groupMemberships: FieldValue.arrayUnion(userMembership) as unknown as GroupMembership[],
    });

    console.log('✅ [createGroup] User groupIds updated');

    return {
      success: true,
      groupId: createdGroup.id,
      message: 'Group created successfully',
    };

  } catch (error: any) {
    console.error('❌ [createGroup] Error:', error);

    if (error.code && error.message) {
      throw error;
    }

    throw new HttpsError('internal', 'Failed to create group');
  }
});
