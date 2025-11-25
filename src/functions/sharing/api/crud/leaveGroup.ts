import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  Family as Group,
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
 * Leave group
 */
export const leaveGroup = onRequest({
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

      // Get groupId (stored as familyId for backward compatibility)
      const groupId = user.familyId;
      if (!groupId) {
        return response.status(400).json(
          createErrorResponse("no-group", "User is not part of any group")
        );
      }

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

      // Check if user is the only admin
      if (group.adminUserId === user.id && group.memberIds.length > 1) {
        return response.status(400).json(
          createErrorResponse(
            "transfer-admin-first",
            "Cannot leave group as the only admin. Transfer admin role to another member first."
          )
        );
      }

      // Execute transaction to leave group
      await executeTransaction(async (transaction) => {
        const isLastMember = group!.memberIds.length === 1;

        // Update group in groups collection
        const groupRef = admin.firestore().collection("groups").doc(groupId!);
        if (isLastMember) {
          // If this is the last member, deactivate the group
          transaction.set(groupRef, {
            ...group,
            isActive: false,
            updatedAt: admin.firestore.Timestamp.now(),
          }, { merge: true });
        } else {
          // Remove user from group members
          transaction.update(groupRef, {
            memberIds: admin.firestore.FieldValue.arrayRemove(user.id),
            updatedAt: admin.firestore.Timestamp.now(),
          });
        }

        // Backward compatibility: also update families collection
        const familyRef = admin.firestore().collection("families").doc(groupId!);
        if (isLastMember) {
          transaction.set(familyRef, {
            ...group,
            isActive: false,
            updatedAt: admin.firestore.Timestamp.now(),
          }, { merge: true });
        } else {
          transaction.update(familyRef, {
            memberIds: admin.firestore.FieldValue.arrayRemove(user.id),
            updatedAt: admin.firestore.Timestamp.now(),
          });
        }

        // Update user - remove familyId (groupId stored as familyId), reset role
        const userRef = admin.firestore().collection("users").doc(user.id!);
        transaction.update(userRef, {
          familyId: admin.firestore.FieldValue.delete(),
          role: UserRole.VIEWER,
          updatedAt: admin.firestore.Timestamp.now(),
        });
      });

      // Update user custom claims
      await setUserClaims(user.id!, {
        role: UserRole.VIEWER
      });

      return response.status(200).json(createSuccessResponse({
        leftGroup: true,
        groupDeactivated: group.memberIds.length === 1
      }));

    } catch (error: any) {
      console.error("Error leaving group:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to leave group")
      );
    }
  });
});