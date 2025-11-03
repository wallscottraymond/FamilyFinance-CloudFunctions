import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  Group,
  UserRole,
  GroupSettings,
  GroupRole,
  GroupMember,
  CreateGroupRequest
} from "../../../../types";
import {
  executeTransaction
} from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
  setUserClaims
} from "../../../../utils/auth";
import {
  validateRequest,
  createFamilySchema
} from "../../../../utils/validation";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Create a new group
 */
export const createGroup = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "POST") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only POST requests are allowed")
      );
    }

    try {
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Check if user already belongs to a group (check familyId field which stores groupId)
      if (user.familyId) {
        return response.status(400).json(
          createErrorResponse("already-in-group", "User already belongs to a group")
        );
      }

      // Validate request body
      const validation = validateRequest(request.body, createFamilySchema);
      if (validation.error) {
        return response.status(400).json(
          createErrorResponse("validation-error", validation.error)
        );
      }

      const groupData = validation.value! as CreateGroupRequest;

      // Default group settings
      const defaultSettings: GroupSettings = {
        allowMemberInvites: true,
        requireApprovalForSharing: false,
        defaultResourceRole: GroupRole.VIEWER,
        maxMembers: 10,
        ...groupData.settings,
      };

      // Create founding member
      const foundingMember: GroupMember = {
        userId: user.id!,
        role: GroupRole.OWNER,
        joinedAt: admin.firestore.Timestamp.now(),
        invitedBy: user.id!,
        status: 'active'
      };

      // Create group document
      const group: Omit<Group, "id" | "createdAt" | "updatedAt"> = {
        name: groupData.name,
        description: groupData.description,
        createdBy: user.id!,
        ownerId: user.id!,
        members: [foundingMember],
        settings: defaultSettings,
        isActive: true,
      };

      // Execute transaction to create group and update user
      const result = await executeTransaction(async (transaction) => {
        // Create group in both collections (groups is primary, families for backward compatibility)
        const groupRef = admin.firestore().collection("groups").doc();
        transaction.set(groupRef, {
          ...group,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Also create in families collection for backward compatibility
        const familyRef = admin.firestore().collection("families").doc(groupRef.id);
        transaction.set(familyRef, {
          ...group,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Update user with group ID and admin role (store in familyId for backward compatibility)
        const userRef = admin.firestore().collection("users").doc(user.id!);
        transaction.update(userRef, {
          familyId: groupRef.id, // Store groupId in familyId field for backward compatibility
          role: UserRole.ADMIN,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        return {
          groupId: groupRef.id,
          group: {
            id: groupRef.id,
            ...group,
            createdAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
          },
        };
      });

      // Update user custom claims (keep using UserRole.ADMIN for backward compatibility)
      await setUserClaims(user.id!, {
        role: UserRole.ADMIN,
        familyId: result.groupId // Backward compatibility - store groupId in familyId field
      });

      return response.status(201).json(createSuccessResponse(result.group));

    } catch (error: any) {
      console.error("Error creating group:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to create group")
      );
    }
  });
});