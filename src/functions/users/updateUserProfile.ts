import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  User, 
  UserRole
} from "../../types";
import { 
  updateDocument 
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  checkUserAccess
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";
import { 
  validateRequest, 
  updateUserSchema 
} from "../../utils/validation";

/**
 * Update user profile
 */
export const updateUserProfile = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "PUT") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only PUT requests are allowed")
      );
    }

    try {
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;
      const targetUserId = (request.query.userId as string) || user.id;

      // Check if user can update target user's profile
      if (targetUserId !== user.id) {
        const hasAccess = await checkUserAccess(user.id!, targetUserId!);
        if (!hasAccess) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot update this user's profile")
          );
        }
      }

      // Validate request body
      const validation = validateRequest(request.body, updateUserSchema);
      if (validation.error) {
        return response.status(400).json(
          createErrorResponse("validation-error", validation.error)
        );
      }

      const updateData = validation.value;

      // Update user profile
      const updatedUser = await updateDocument<User>("users", targetUserId!, updateData);

      // Update display name in Firebase Auth if changed
      if (updateData.displayName) {
        try {
          await admin.auth().updateUser(targetUserId!, {
            displayName: updateData.displayName,
          });
        } catch (error) {
          console.warn(`Could not update display name in Auth for user ${targetUserId}:`, error);
        }
      }

      return response.status(200).json(createSuccessResponse(updatedUser));

    } catch (error: any) {
      console.error("Error updating user profile:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to update user profile")
      );
    }
  });
});