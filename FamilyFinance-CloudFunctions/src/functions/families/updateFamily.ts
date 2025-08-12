import { onRequest } from "firebase-functions/v2/https";
import { 
  Family, 
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
 * Update family settings
 */
export const updateFamily = onRequest({
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
      // Authenticate user (only admin can update family)
      const authResult = await authMiddleware(request, UserRole.ADMIN);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User does not belong to any family")
        );
      }

      const updateData = request.body;
      
      // Validate that user is admin of this family
      const family = await getDocument<Family>("families", user.familyId);
      if (!family || family.adminUserId !== user.id) {
        return response.status(403).json(
          createErrorResponse("not-family-admin", "Only family admin can update family settings")
        );
      }

      // Update family
      const updatedFamily = await updateDocument<Family>("families", user.familyId, updateData);

      return response.status(200).json(createSuccessResponse(updatedFamily));

    } catch (error: any) {
      console.error("Error updating family:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to update family")
      );
    }
  });
});