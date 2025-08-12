import { onRequest } from "firebase-functions/v2/https";
import { 
  User, 
  UserRole
} from "../../types";
import { 
  getDocument
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  checkUserAccess
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Get user profile
 */
export const getUserProfile = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "GET") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only GET requests are allowed")
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

      // Check if user can access target user's profile
      if (targetUserId !== user.id) {
        const hasAccess = await checkUserAccess(user.id!, targetUserId!);
        if (!hasAccess) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot access this user's profile")
          );
        }
      }

      // Get user profile
      const userProfile = await getDocument<User>("users", targetUserId!);
      if (!userProfile) {
        return response.status(404).json(
          createErrorResponse("user-not-found", "User profile not found")
        );
      }

      return response.status(200).json(createSuccessResponse(userProfile));

    } catch (error: any) {
      console.error("Error getting user profile:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get user profile")
      );
    }
  });
});