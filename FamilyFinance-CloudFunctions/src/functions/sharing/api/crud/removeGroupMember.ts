import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  Family as Group,
  User,
  UserRole
} from "../../../../types";
import {
  getDocument,
  executeTransaction
} from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
  setUserClaims
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Remove group member (admin only)
 */
export const removeGroupMember = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "DELETE") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only DELETE requests are allowed")
      );
    }

    try {
      // Authenticate user (only admin can remove members)
      const authResult = await authMiddleware(request, UserRole.ADMIN);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;
      const memberToRemoveId = request.query.memberId as string;

      if (!memberToRemoveId) {
        return response.status(400).json(
          createErrorResponse("missing-parameter", "Member ID is required")
        );
      }

      // Get groupId (stored as familyId for backward compatibility)
      const groupId = user.familyId;
      if (!groupId) {
        return response.status(400).json(
          createErrorResponse("no-group", "User is not part of any group")
        );
      }

      // Cannot remove self
      if (memberToRemoveId === user.id) {
        return response.status(400).json(
          createErrorResponse("cannot-remove-self", "Cannot remove yourself. Use leave group instead.")
        );
      }

      // Get group and member
      const memberToRemove = await getDocument<User>("users", memberToRemoveId);

      // Try to get group from groups collection first, fallback to families collection
      let group = await getDocument<Group>("groups", groupId);
      if (!group) {
        // Backward compatibility: try families collection
        group = await getDocument<Group>("families", groupId);
      }

      if (!group) {
        return response.status(404).json(
          createErrorResponse("group-not-found", "Group not found")
        );
      }

      // Check if member belongs to the same group (groupId stored as familyId for backward compatibility)
      if (!memberToRemove || memberToRemove.familyId !== groupId) {
        return response.status(404).json(
          createErrorResponse("member-not-found", "Group member not found")
        );
      }

      // Remove member from group
      await executeTransaction(async (transaction) => {
        // Update group in groups collection - remove member
        const groupRef = admin.firestore().collection("groups").doc(groupId!);
        transaction.update(groupRef, {
          memberIds: admin.firestore.FieldValue.arrayRemove(memberToRemoveId),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Backward compatibility: also update families collection
        const familyRef = admin.firestore().collection("families").doc(groupId!);
        transaction.update(familyRef, {
          memberIds: admin.firestore.FieldValue.arrayRemove(memberToRemoveId),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Update user - remove familyId (groupId stored as familyId for backward compatibility)
        const userRef = admin.firestore().collection("users").doc(memberToRemoveId);
        transaction.update(userRef, {
          familyId: admin.firestore.FieldValue.delete(),
          role: UserRole.VIEWER,
          updatedAt: admin.firestore.Timestamp.now(),
        });
      });

      // Update removed user's custom claims
      await setUserClaims(memberToRemoveId, {
        role: UserRole.VIEWER
      });

      return response.status(200).json(createSuccessResponse({
        removedMember: true,
        memberId: memberToRemoveId
      }));

    } catch (error: any) {
      console.error("Error removing group member:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to remove group member")
      );
    }
  });
});