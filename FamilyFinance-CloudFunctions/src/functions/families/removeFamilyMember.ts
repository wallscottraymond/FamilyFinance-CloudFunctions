import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  Family, 
  User, 
  UserRole
} from "../../types";
import { 
  getDocument, 
  executeTransaction
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  setUserClaims
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Remove family member (admin only)
 */
export const removeFamilyMember = onRequest({
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

      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User is not part of any family")
        );
      }

      // Cannot remove self
      if (memberToRemoveId === user.id) {
        return response.status(400).json(
          createErrorResponse("cannot-remove-self", "Cannot remove yourself. Use leave family instead.")
        );
      }

      // Get family and member
      const [family, memberToRemove] = await Promise.all([
        getDocument<Family>("families", user.familyId),
        getDocument<User>("users", memberToRemoveId)
      ]);

      if (!family) {
        return response.status(404).json(
          createErrorResponse("family-not-found", "Family not found")
        );
      }

      if (!memberToRemove || memberToRemove.familyId !== user.familyId) {
        return response.status(404).json(
          createErrorResponse("member-not-found", "Family member not found")
        );
      }

      // Remove member from family
      await executeTransaction(async (transaction) => {
        // Update family - remove member
        const familyRef = admin.firestore().collection("families").doc(user.familyId!);
        transaction.update(familyRef, {
          memberIds: admin.firestore.FieldValue.arrayRemove(memberToRemoveId),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Update user - remove family association
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
      console.error("Error removing family member:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to remove family member")
      );
    }
  });
});