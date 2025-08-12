import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  Family, 
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
 * Leave family
 */
export const leaveFamily = onRequest({
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

      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User is not part of any family")
        );
      }

      // Get family
      const family = await getDocument<Family>("families", user.familyId);
      if (!family) {
        return response.status(404).json(
          createErrorResponse("family-not-found", "Family not found")
        );
      }

      // Check if user is the only admin
      if (family.adminUserId === user.id && family.memberIds.length > 1) {
        return response.status(400).json(
          createErrorResponse(
            "transfer-admin-first",
            "Cannot leave family as the only admin. Transfer admin role to another member first."
          )
        );
      }

      // Execute transaction to leave family
      await executeTransaction(async (transaction) => {
        const familyRef = admin.firestore().collection("families").doc(user.familyId!);
        
        if (family.memberIds.length === 1) {
          // If this is the last member, deactivate the family
          transaction.update(familyRef, {
            isActive: false,
            updatedAt: admin.firestore.Timestamp.now(),
          });
        } else {
          // Remove user from family members
          transaction.update(familyRef, {
            memberIds: admin.firestore.FieldValue.arrayRemove(user.id),
            updatedAt: admin.firestore.Timestamp.now(),
          });
        }

        // Update user - remove family ID and reset role
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
        leftFamily: true,
        familyDeactivated: family.memberIds.length === 1 
      }));

    } catch (error: any) {
      console.error("Error leaving family:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to leave family")
      );
    }
  });
});