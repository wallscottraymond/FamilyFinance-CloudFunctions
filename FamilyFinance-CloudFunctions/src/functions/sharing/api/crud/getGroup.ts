import { onRequest } from "firebase-functions/v2/https";
import {
  Family as Group,
  User,
  UserRole
} from "../../../../types";
import {
  getDocument
} from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Get group details
 */
export const getGroup = onRequest({
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

      // Get groupId (stored as familyId for backward compatibility)
      const groupId = user.familyId;
      if (!groupId) {
        return response.status(404).json(
          createErrorResponse("no-group", "User does not belong to any group")
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

      // Get group members details
      const memberPromises = group.memberIds.map(memberId =>
        getDocument<User>("users", memberId)
      );
      const members = (await Promise.all(memberPromises)).filter(member => member !== null);

      const groupWithMembers = {
        ...group,
        members: members.map(member => ({
          id: member!.id,
          email: member!.email,
          displayName: member!.displayName,
          photoURL: member!.photoURL,
          role: member!.role,
          isActive: member!.isActive,
        })),
      };

      return response.status(200).json(createSuccessResponse(groupWithMembers));

    } catch (error: any) {
      console.error("Error getting group:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get group")
      );
    }
  });
});