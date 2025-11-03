import { onRequest } from "firebase-functions/v2/https";
import { 
  Budget, 
  UserRole
} from "../../../../types";
import { 
  getDocument, 
  updateDocument
} from "../../../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  checkFamilyAccess 
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Update budget
 */
export const updateBudget = onRequest({
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
      const budgetId = request.query.id as string;
      if (!budgetId) {
        return response.status(400).json(
          createErrorResponse("missing-parameter", "Budget ID is required")
        );
      }

      // Authenticate user (minimum VIEWER role - ownership checked next)
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Get existing budget to check ownership
      const existingBudget = await getDocument<Budget>("budgets", budgetId);
      if (!existingBudget) {
        return response.status(404).json(
          createErrorResponse("budget-not-found", "Budget not found")
        );
      }

      // Check permissions: OWNER always allowed, OR EDITOR/ADMIN role
      const isOwner = existingBudget.createdBy === user.id;
      const isEditor = user.role === UserRole.EDITOR || user.role === UserRole.ADMIN;

      if (!isOwner && !isEditor) {
        return response.status(403).json(
          createErrorResponse("permission-denied", "Cannot edit this budget - you must be the owner or have editor role")
        );
      }

      // Check access - for individual budgets check ownership, for shared budgets check family access
      if (existingBudget.isShared && existingBudget.familyId) {
        // Shared budget - check family access
        if (!await checkFamilyAccess(user.id!, existingBudget.familyId)) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot access this family budget")
          );
        }
      } else {
        // Individual budget - check ownership or membership
        if (existingBudget.createdBy !== user.id! && !(existingBudget.memberIds || []).includes(user.id!)) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot update budget you don't have access to")
          );
        }
      }

      const updateData = request.body;

      // If amount is being updated, recalculate remaining
      if (updateData.amount !== undefined) {
        updateData.remaining = updateData.amount - existingBudget.spent;
      }

      // Update budget
      const updatedBudget = await updateDocument<Budget>("budgets", budgetId, updateData);

      return response.status(200).json(createSuccessResponse(updatedBudget));

    } catch (error: any) {
      console.error("Error updating budget:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to update budget")
      );
    }
  });
});