import { onRequest } from "firebase-functions/v2/https";
import { 
  Family, 
  User, 
  UserRole
} from "../../types";
import { 
  getDocument
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Get family details
 */
export const getFamily = onRequest({
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

      if (!user.familyId) {
        return response.status(404).json(
          createErrorResponse("no-family", "User does not belong to any family")
        );
      }

      // Get family document
      const family = await getDocument<Family>("families", user.familyId);
      if (!family) {
        return response.status(404).json(
          createErrorResponse("family-not-found", "Family not found")
        );
      }

      // Get family members details
      const memberPromises = family.memberIds.map(memberId => 
        getDocument<User>("users", memberId)
      );
      const members = (await Promise.all(memberPromises)).filter(member => member !== null);

      const familyWithMembers = {
        ...family,
        members: members.map(member => ({
          id: member!.id,
          email: member!.email,
          displayName: member!.displayName,
          photoURL: member!.photoURL,
          role: member!.role,
          isActive: member!.isActive,
        })),
      };

      return response.status(200).json(createSuccessResponse(familyWithMembers));

    } catch (error: any) {
      console.error("Error getting family:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get family")
      );
    }
  });
});