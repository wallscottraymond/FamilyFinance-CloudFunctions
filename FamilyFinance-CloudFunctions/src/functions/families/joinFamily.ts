import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  Family, 
  UserRole, 
  InviteCode
} from "../../types";
import { 
  executeTransaction
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  setUserClaims
} from "../../utils/auth";
import { 
  validateRequest, 
  joinFamilySchema
} from "../../utils/validation";
import { firebaseCors } from "../../middleware/cors";

/**
 * Join family using invite code
 */
export const joinFamily = onRequest({
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
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Check if user already belongs to a family
      if (user.familyId) {
        return response.status(400).json(
          createErrorResponse("already-in-family", "User already belongs to a family")
        );
      }

      // Validate request body
      const validation = validateRequest(request.body, joinFamilySchema);
      if (validation.error) {
        return response.status(400).json(
          createErrorResponse("validation-error", validation.error)
        );
      }

      const { inviteCode } = validation.value!;

      // Find family with the invite code
      const familiesSnapshot = await admin.firestore()
        .collection("families")
        .get();

      let targetFamily: Family | null = null;
      let validInviteCode: InviteCode | null = null;

      for (const doc of familiesSnapshot.docs) {
        const family = { id: doc.id, ...doc.data() } as Family;
        const invite = family.inviteCodes.find(
          code => code.code === inviteCode && 
                  code.isActive && 
                  code.expiresAt.toDate() > new Date() &&
                  !code.usedBy
        );
        
        if (invite) {
          targetFamily = family;
          validInviteCode = invite;
          break;
        }
      }

      if (!targetFamily || !validInviteCode) {
        return response.status(404).json(
          createErrorResponse("invalid-invite", "Invalid or expired invite code")
        );
      }

      // Execute transaction to join family
      await executeTransaction(async (transaction) => {
        // Update family - add user to members and mark invite code as used
        const familyRef = admin.firestore().collection("families").doc(targetFamily!.id!);
        const updatedInviteCodes = targetFamily!.inviteCodes.map(code => 
          code.code === inviteCode 
            ? { ...code, usedBy: user.id, isActive: false }
            : code
        );
        
        transaction.update(familyRef, {
          memberIds: admin.firestore.FieldValue.arrayUnion(user.id),
          inviteCodes: updatedInviteCodes,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Update user with family ID and role
        const userRef = admin.firestore().collection("users").doc(user.id!);
        transaction.update(userRef, {
          familyId: targetFamily!.id,
          role: validInviteCode!.role,
          updatedAt: admin.firestore.Timestamp.now(),
        });
      });

      // Update user custom claims
      await setUserClaims(user.id!, { 
        role: validInviteCode.role, 
        familyId: targetFamily.id 
      });

      return response.status(200).json(createSuccessResponse({
        familyId: targetFamily.id,
        familyName: targetFamily.name,
        role: validInviteCode.role,
      }));

    } catch (error: any) {
      console.error("Error joining family:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to join family")
      );
    }
  });
});