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
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Delete user account
 */
export const deleteUser = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 60,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "DELETE") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only DELETE requests are allowed")
      );
    }

    try {
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;
      
      // Only users can delete their own accounts, or admin can delete any account
      const targetUserId = (request.query.userId as string) || user.id;
      if (targetUserId !== user.id && user.role !== UserRole.ADMIN) {
        return response.status(403).json(
          createErrorResponse("permission-denied", "Cannot delete this user account")
        );
      }

      // Check if user is family admin
      if (user.familyId && user.role === UserRole.ADMIN) {
        // Get family to check if this is the only admin
        const family = await getDocument("families", user.familyId);
        if (family && (family as any).adminUserId === user.id) {
          // Check if there are other family members
          if ((family as any).memberIds.length > 1) {
            return response.status(400).json(
              createErrorResponse(
                "cannot-delete-admin", 
                "Cannot delete account while being the only family admin. Transfer admin role first."
              )
            );
          }
        }
      }

      // Soft delete - mark as inactive instead of hard delete for data integrity
      await updateDocument<User>("users", targetUserId!, {
        isActive: false,
        email: `deleted_${Date.now()}_${user.email}`,
      });

      // Optionally, delete from Firebase Auth (uncomment if hard delete is required)
      // await deleteUserAccount(targetUserId);

      return response.status(200).json(createSuccessResponse({ deleted: true }));

    } catch (error: any) {
      console.error("Error deleting user account:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to delete user account")
      );
    }
  });
});