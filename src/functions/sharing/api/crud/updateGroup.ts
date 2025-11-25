import { onRequest } from "firebase-functions/v2/https";
import {
  Family as Group,
  UserRole
} from "../../../../types";
import {
  getDocument,
  updateDocument
} from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Update group settings
 */
export const updateGroup = onRequest({
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
      // Authenticate user (only admin can update group)
      const authResult = await authMiddleware(request, UserRole.ADMIN);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Get groupId (stored as familyId for backward compatibility)
      const groupId = user.familyId;
      if (!groupId) {
        return response.status(400).json(
          createErrorResponse("no-group", "User does not belong to any group")
        );
      }

      const updateData = request.body;

      // Try to get group from groups collection first, fallback to families collection
      let group = await getDocument<Group>("groups", groupId);
      let isLegacyFamily = false;
      if (!group) {
        // Backward compatibility: try families collection
        group = await getDocument<Group>("families", groupId);
        isLegacyFamily = true;
      }

      // Validate that user is admin of this group
      if (!group || group.adminUserId !== user.id) {
        return response.status(403).json(
          createErrorResponse("not-group-admin", "Only group admin can update group settings")
        );
      }

      // Update group in groups collection
      const updatedGroup = await updateDocument<Group>("groups", groupId, updateData);

      // Backward compatibility: also update families collection if it exists there
      if (isLegacyFamily) {
        await updateDocument<Group>("families", groupId, updateData);
      }

      return response.status(200).json(createSuccessResponse(updatedGroup));

    } catch (error: any) {
      console.error("Error updating group:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to update group")
      );
    }
  });
});