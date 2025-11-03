import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  Family as Group,
  UserRole,
  InviteCode
} from "../../../../types";
import {
  executeTransaction
} from "../../../../utils/firestore";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
  setUserClaims
} from "../../../../utils/auth";
import {
  validateRequest,
  joinFamilySchema
} from "../../../../utils/validation";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Join group using invite code
 */
export const joinGroup = onRequest({
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

      // Check if user already belongs to a group (stored as familyId for backward compatibility)
      if (user.familyId) {
        return response.status(400).json(
          createErrorResponse("already-in-group", "User already belongs to a group")
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

      // Find group with the invite code - search both groups and families collections
      const [groupsSnapshot, familiesSnapshot] = await Promise.all([
        admin.firestore().collection("groups").get(),
        admin.firestore().collection("families").get()
      ]);

      let targetGroup: Group | null = null;
      let validInviteCode: InviteCode | null = null;

      // Search groups collection first
      for (const doc of groupsSnapshot.docs) {
        const group = { id: doc.id, ...doc.data() } as Group;
        const invite = group.inviteCodes.find(
          code => code.code === inviteCode &&
                  code.isActive &&
                  code.expiresAt.toDate() > new Date() &&
                  !code.usedBy
        );

        if (invite) {
          targetGroup = group;
          validInviteCode = invite;
          break;
        }
      }

      // Backward compatibility: search families collection if not found in groups
      if (!targetGroup) {
        for (const doc of familiesSnapshot.docs) {
          const group = { id: doc.id, ...doc.data() } as Group;
          const invite = group.inviteCodes.find(
            code => code.code === inviteCode &&
                    code.isActive &&
                    code.expiresAt.toDate() > new Date() &&
                    !code.usedBy
          );

          if (invite) {
            targetGroup = group;
            validInviteCode = invite;
            break;
          }
        }
      }

      if (!targetGroup || !validInviteCode) {
        return response.status(404).json(
          createErrorResponse("invalid-invite", "Invalid or expired invite code")
        );
      }

      // Execute transaction to join group
      await executeTransaction(async (transaction) => {
        const updatedInviteCodes = targetGroup!.inviteCodes.map(code =>
          code.code === inviteCode
            ? { ...code, usedBy: user.id, isActive: false }
            : code
        );

        // Update group in groups collection - add user to members and mark invite code as used
        const groupRef = admin.firestore().collection("groups").doc(targetGroup!.id!);
        transaction.set(groupRef, {
          ...targetGroup,
          memberIds: admin.firestore.FieldValue.arrayUnion(user.id),
          inviteCodes: updatedInviteCodes,
          updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });

        // Backward compatibility: also update families collection
        const familyRef = admin.firestore().collection("families").doc(targetGroup!.id!);
        transaction.set(familyRef, {
          ...targetGroup,
          memberIds: admin.firestore.FieldValue.arrayUnion(user.id),
          inviteCodes: updatedInviteCodes,
          updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });

        // Update user with familyId (groupId stored as familyId for backward compatibility)
        const userRef = admin.firestore().collection("users").doc(user.id!);
        transaction.update(userRef, {
          familyId: targetGroup!.id,
          role: validInviteCode!.role,
          updatedAt: admin.firestore.Timestamp.now(),
        });
      });

      // Update user custom claims
      await setUserClaims(user.id!, {
        role: validInviteCode.role,
        familyId: targetGroup.id
      });

      return response.status(200).json(createSuccessResponse({
        groupId: targetGroup.id,
        groupName: targetGroup.name,
        role: validInviteCode.role,
      }));

    } catch (error: any) {
      console.error("Error joining group:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to join group")
      );
    }
  });
});