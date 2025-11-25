import { onRequest } from "firebase-functions/v2/https";
import { 
  Budget, 
  UserRole
} from "../../../../types";
import { 
  getDocument, 
  queryDocuments,
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
 * Get budget by ID
 */
export const getBudget = onRequest({
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
      const budgetId = request.query.id as string;
      if (!budgetId) {
        return response.status(400).json(
          createErrorResponse("missing-parameter", "Budget ID is required")
        );
      }

      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Get budget
      const budget = await getDocument<Budget>("budgets", budgetId);
      if (!budget) {
        return response.status(404).json(
          createErrorResponse("budget-not-found", "Budget not found")
        );
      }

      // Check access - for individual budgets check ownership/membership, for shared budgets check family access
      if (budget.isShared && budget.familyId) {
        // Shared budget - check family access
        if (!await checkFamilyAccess(user.id!, budget.familyId)) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot access this family budget")
          );
        }
      } else {
        // Individual budget - check ownership or membership
        if (budget.createdBy !== user.id! && !(budget.memberIds || []).includes(user.id!)) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot access this budget")
          );
        }
      }

      // Calculate current spent amount and update budget if needed
      const updatedBudget = await updateBudgetSpentAmount(budget);

      return response.status(200).json(createSuccessResponse(updatedBudget));

    } catch (error: any) {
      console.error("Error getting budget:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get budget")
      );
    }
  });
});

/**
 * Helper function to update budget spent amount
 */
async function updateBudgetSpentAmount(budget: Budget): Promise<Budget> {
  try {
    // Get all approved expense transactions for this budget
    const transactions = await queryDocuments("transactions", {
      where: [
        { field: "budgetId", operator: "==", value: budget.id },
        { field: "status", operator: "==", value: "approved" },
        { field: "type", operator: "==", value: "expense" },
        { field: "date", operator: ">=", value: budget.startDate },
        { field: "date", operator: "<=", value: budget.endDate },
      ],
    });

    const totalSpent = transactions.reduce((sum: number, transaction: any) => sum + transaction.amount, 0);
    const remaining = budget.amount - totalSpent;

    // Update budget if spent amount has changed
    if (totalSpent !== budget.spent) {
      const updatedBudget = await updateDocument<Budget>("budgets", budget.id!, {
        spent: totalSpent,
        remaining,
      });
      return updatedBudget;
    }

    return budget;
  } catch (error) {
    console.error("Error updating budget spent amount:", error);
    return budget;
  }
}