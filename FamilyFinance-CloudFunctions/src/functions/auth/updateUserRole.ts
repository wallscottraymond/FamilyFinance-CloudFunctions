import { onRequest } from "firebase-functions/v2/https";
import { 
  User, 
  UserRole
} from "../../types";
import { 
  getDocument, 
  updateDocument
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  setUserClaims,
  revokeUserTokens
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Update user role (admin only)
 */
export const updateUserRole = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 60,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "PUT") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only PUT requests are allowed")
      );
    }

    try {
      // Authenticate user (only admin can update roles)
      const authResult = await authMiddleware(request, UserRole.ADMIN);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user: adminUser } = authResult;
      const { userId, newRole } = request.body;

      if (!userId || !newRole) {
        return response.status(400).json(
          createErrorResponse("missing-parameters", "User ID and new role are required")
        );
      }

      // Validate new role
      if (!Object.values(UserRole).includes(newRole)) {
        return response.status(400).json(
          createErrorResponse("invalid-role", "Invalid user role")
        );
      }

      if (!adminUser.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "Admin must belong to a family")
        );
      }

      // Get target user
      const targetUser = await getDocument<User>("users", userId);
      if (!targetUser) {
        return response.status(404).json(
          createErrorResponse("user-not-found", "User not found")
        );
      }

      // Check if target user is in the same family
      if (targetUser.familyId !== adminUser.familyId) {
        return response.status(403).json(
          createErrorResponse("different-family", "Can only update roles for family members")
        );
      }

      // Cannot change own role
      if (targetUser.id === adminUser.id) {
        return response.status(400).json(
          createErrorResponse("cannot-change-own-role", "Cannot change your own role")
        );
      }

      // Update user role
      const updatedUser = await updateDocument<User>("users", userId, {
        role: newRole,
      });

      // Update custom claims
      await setUserClaims(userId, {
        role: newRole,
        familyId: targetUser.familyId,
      });

      // Force token refresh for the target user
      await revokeUserTokens(userId);

      return response.status(200).json(createSuccessResponse({
        userId,
        oldRole: targetUser.role,
        newRole,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          displayName: updatedUser.displayName,
          role: updatedUser.role,
        },
      }));

    } catch (error: any) {
      console.error("Error updating user role:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to update user role")
      );
    }
  });
});