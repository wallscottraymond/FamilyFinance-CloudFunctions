import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  Family as Group,
  UserRole,
  InviteCode
} from "../../../../types";
import {
  getDocument,
  updateDocument
} from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
  generateInviteCode
} from "../../../../utils/auth";
import {
  validateRequest,
  inviteCodeSchema
} from "../../../../utils/validation";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Generate group invite code
 */
export const generateGroupInvite = onRequest({
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
      // Authenticate user (parent or admin can create invites)
      const authResult = await authMiddleware(request, UserRole.EDITOR);
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

      // Validate request body
      const validation = validateRequest(request.body, inviteCodeSchema);
      if (validation.error) {
        return response.status(400).json(
          createErrorResponse("validation-error", validation.error)
        );
      }

      const { role, expiresInHours } = validation.value;

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

      // Generate unique invite code
      let inviteCode: string;
      let codeExists = true;

      while (codeExists) {
        inviteCode = generateInviteCode(8);
        // Check if code already exists in any group or family
        const [existingGroup, existingFamily] = await Promise.all([
          admin.firestore()
            .collection("groups")
            .where("inviteCodes", "array-contains-any", [inviteCode])
            .get(),
          admin.firestore()
            .collection("families")
            .where("inviteCodes", "array-contains-any", [inviteCode])
            .get()
        ]);
        codeExists = !existingGroup.empty || !existingFamily.empty;
      }

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiresInHours!);

      const newInviteCode: InviteCode = {
        code: inviteCode!,
        createdAt: admin.firestore.Timestamp.now(),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        role,
        isActive: true,
      };

      // Add invite code to group
      const updatedInviteCodes = [...group.inviteCodes, newInviteCode];

      // Update groups collection
      await updateDocument<Group>("groups", groupId, {
        inviteCodes: updatedInviteCodes,
      });

      // Backward compatibility: also update families collection
      await updateDocument<Group>("families", groupId, {
        inviteCodes: updatedInviteCodes,
      });

      return response.status(201).json(createSuccessResponse({
        inviteCode: inviteCode!,
        role,
        expiresAt: expiresAt.toISOString(),
      }));

    } catch (error: any) {
      console.error("Error generating group invite:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to generate invite code")
      );
    }
  });
});