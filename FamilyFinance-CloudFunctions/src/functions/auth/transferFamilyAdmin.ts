import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
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
  setUserClaims,
  revokeUserTokens
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Transfer family admin role
 */
export const transferFamilyAdmin = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 60,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "POST") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only POST requests are allowed")
      );
    }

    try {
      // Authenticate user (only current admin can transfer)
      const authResult = await authMiddleware(request, UserRole.ADMIN);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user: currentAdmin } = authResult;
      const { newAdminUserId } = request.body;

      if (!newAdminUserId) {
        return response.status(400).json(
          createErrorResponse("missing-parameter", "New admin user ID is required")
        );
      }

      if (!currentAdmin.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "Current admin must belong to a family")
        );
      }

      // Cannot transfer to self
      if (newAdminUserId === currentAdmin.id) {
        return response.status(400).json(
          createErrorResponse("invalid-transfer", "Cannot transfer admin role to yourself")
        );
      }

      // Get new admin user
      const newAdminUser = await getDocument<User>("users", newAdminUserId);
      if (!newAdminUser) {
        return response.status(404).json(
          createErrorResponse("user-not-found", "New admin user not found")
        );
      }

      // Check if new admin is in the same family
      if (newAdminUser.familyId !== currentAdmin.familyId) {
        return response.status(403).json(
          createErrorResponse("different-family", "New admin must be a family member")
        );
      }

      // Get family document
      const family = await getDocument("families", currentAdmin.familyId);
      if (!family || (family as any).adminUserId !== currentAdmin.id) {
        return response.status(403).json(
          createErrorResponse("not-family-admin", "Only current family admin can transfer admin role")
        );
      }

      // Execute transaction to transfer admin role
      await admin.firestore().runTransaction(async (transaction) => {
        // Update family admin
        const familyRef = admin.firestore().collection("families").doc(currentAdmin.familyId!);
        transaction.update(familyRef, {
          adminUserId: newAdminUserId,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Update new admin user role
        const newAdminRef = admin.firestore().collection("users").doc(newAdminUserId);
        transaction.update(newAdminRef, {
          role: UserRole.ADMIN,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Update current admin role to parent
        const currentAdminRef = admin.firestore().collection("users").doc(currentAdmin.id!);
        transaction.update(currentAdminRef, {
          role: UserRole.PARENT,
          updatedAt: admin.firestore.Timestamp.now(),
        });
      });

      // Update custom claims for both users
      await Promise.all([
        setUserClaims(newAdminUserId, {
          role: UserRole.ADMIN,
          familyId: currentAdmin.familyId,
        }),
        setUserClaims(currentAdmin.id!, {
          role: UserRole.PARENT,
          familyId: currentAdmin.familyId,
        }),
      ]);

      // Force token refresh for both users
      await Promise.all([
        revokeUserTokens(newAdminUserId),
        revokeUserTokens(currentAdmin.id!),
      ]);

      return response.status(200).json(createSuccessResponse({
        transferred: true,
        previousAdmin: {
          id: currentAdmin.id,
          email: currentAdmin.email,
          displayName: currentAdmin.displayName,
          newRole: UserRole.PARENT,
        },
        newAdmin: {
          id: newAdminUserId,
          email: newAdminUser.email,
          displayName: newAdminUser.displayName,
          role: UserRole.ADMIN,
        },
      }));

    } catch (error: any) {
      console.error("Error transferring family admin:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to transfer admin role")
      );
    }
  });
});