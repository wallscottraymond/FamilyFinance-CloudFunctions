import { onRequest } from "firebase-functions/v2/https";
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
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Update user notification preferences
 */
export const updateNotificationPreferences = onRequest({
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
      const notifications = request.body.notifications;

      if (!notifications || typeof notifications !== "object") {
        return response.status(400).json(
          createErrorResponse("invalid-data", "Notification preferences are required")
        );
      }

      // Update notification preferences
      const updatedUser = await updateDocument<User>("users", user.id!, {
        preferences: {
          ...user.preferences,
          notifications: {
            ...user.preferences.notifications,
            ...notifications,
          },
        },
      });

      return response.status(200).json(createSuccessResponse(updatedUser.preferences.notifications));

    } catch (error: any) {
      console.error("Error updating notification preferences:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to update notification preferences")
      );
    }
  });
});