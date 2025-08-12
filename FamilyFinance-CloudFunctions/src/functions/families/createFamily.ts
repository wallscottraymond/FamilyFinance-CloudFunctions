import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  Family, 
  UserRole,
  FamilySettings
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
  createFamilySchema
} from "../../utils/validation";
import { firebaseCors } from "../../middleware/cors";

/**
 * Create a new family
 */
export const createFamily = onRequest({
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
      const validation = validateRequest(request.body, createFamilySchema);
      if (validation.error) {
        return response.status(400).json(
          createErrorResponse("validation-error", validation.error)
        );
      }

      const familyData = validation.value!;

      // Default family settings
      const defaultSettings: FamilySettings = {
        currency: "USD",
        budgetPeriod: "monthly",
        requireApprovalForExpenses: false,
        expenseApprovalLimit: 100,
        allowChildTransactions: true,
        ...familyData.settings,
      };

      // Create family document
      const family: Omit<Family, "id" | "createdAt" | "updatedAt"> = {
        name: familyData.name,
        description: familyData.description,
        adminUserId: user.id!,
        memberIds: [user.id!],
        inviteCodes: [],
        settings: defaultSettings,
        isActive: true,
      };

      // Execute transaction to create family and update user
      const result = await executeTransaction(async (transaction) => {
        // Create family
        const familyRef = admin.firestore().collection("families").doc();
        transaction.set(familyRef, {
          ...family,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Update user with family ID and admin role
        const userRef = admin.firestore().collection("users").doc(user.id!);
        transaction.update(userRef, {
          familyId: familyRef.id,
          role: UserRole.ADMIN,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        return {
          familyId: familyRef.id,
          family: {
            id: familyRef.id,
            ...family,
            createdAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
          },
        };
      });

      // Update user custom claims
      await setUserClaims(user.id!, { 
        role: UserRole.ADMIN, 
        familyId: result.familyId 
      });

      return response.status(201).json(createSuccessResponse(result.family));

    } catch (error: any) {
      console.error("Error creating family:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to create family")
      );
    }
  });
});