import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  Family, 
  UserRole, 
  InviteCode
} from "../../types";
import { 
  getDocument, 
  updateDocument
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  generateInviteCode
} from "../../utils/auth";
import { 
  validateRequest, 
  inviteCodeSchema
} from "../../utils/validation";
import { firebaseCors } from "../../middleware/cors";

/**
 * Generate family invite code
 */
export const generateFamilyInvite = onRequest({
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
      const authResult = await authMiddleware(request, UserRole.PARENT);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User does not belong to any family")
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

      // Get current family
      const family = await getDocument<Family>("families", user.familyId);
      if (!family) {
        return response.status(404).json(
          createErrorResponse("family-not-found", "Family not found")
        );
      }

      // Generate unique invite code
      let inviteCode: string;
      let codeExists = true;
      
      while (codeExists) {
        inviteCode = generateInviteCode(8);
        // Check if code already exists in any family
        const existingFamily = await admin.firestore()
          .collection("families")
          .where("inviteCodes", "array-contains-any", [inviteCode])
          .get();
        codeExists = !existingFamily.empty;
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

      // Add invite code to family
      const updatedInviteCodes = [...family.inviteCodes, newInviteCode];
      await updateDocument<Family>("families", user.familyId, {
        inviteCodes: updatedInviteCodes,
      });

      return response.status(201).json(createSuccessResponse({
        inviteCode: inviteCode!,
        role,
        expiresAt: expiresAt.toISOString(),
      }));

    } catch (error: any) {
      console.error("Error generating family invite:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to generate invite code")
      );
    }
  });
});