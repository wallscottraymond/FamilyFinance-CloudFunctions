import { onRequest } from "firebase-functions/v2/https";
import { 
  Budget, 
  UserRole
} from "../../types";
import { 
  getDocument, 
  updateDocument
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  checkFamilyAccess 
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Delete budget
 */
export const deleteBudget = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "DELETE") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only DELETE requests are allowed")
      );
    }

    try {
      const budgetId = request.query.id as string;
      if (!budgetId) {
        return response.status(400).json(
          createErrorResponse("missing-parameter", "Budget ID is required")
        );
      }

      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.PARENT);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Get existing budget
      const existingBudget = await getDocument<Budget>("budgets", budgetId);
      if (!existingBudget) {
        return response.status(404).json(
          createErrorResponse("budget-not-found", "Budget not found")
        );
      }

      // Check permissions
      const canDelete = user.role === UserRole.ADMIN || existingBudget.createdBy === user.id;
      if (!canDelete) {
        return response.status(403).json(
          createErrorResponse("permission-denied", "Cannot delete this budget")
        );
      }

      // Check family access
      if (!await checkFamilyAccess(user.id!, existingBudget.familyId)) {
        return response.status(403).json(
          createErrorResponse("access-denied", "Cannot access this budget")
        );
      }

      // Soft delete - mark as inactive
      await updateDocument<Budget>("budgets", budgetId, { isActive: false });

      return response.status(200).json(createSuccessResponse({ deleted: true }));

    } catch (error: any) {
      console.error("Error deleting budget:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to delete budget")
      );
    }
  });
});