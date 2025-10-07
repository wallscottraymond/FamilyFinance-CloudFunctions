import { onRequest } from "firebase-functions/v2/https";
import { 
  Budget, 
  UserRole
} from "../../../../types";
import { 
  queryDocuments,
  updateDocument
} from "../../../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";

/**
 * Get user budgets (budgets user is a member of)
 */
export const getUserBudgets = onRequest({
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
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;
      const targetUserId = (request.query.userId as string) || user.id;

      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User must belong to a family")
        );
      }

      // Query budgets where user is a member
      const budgets = await queryDocuments<Budget>("budgets", {
        where: [
          { field: "familyId", operator: "==", value: user.familyId },
          { field: "memberIds", operator: "array-contains", value: targetUserId },
          { field: "isActive", operator: "==", value: true },
        ],
        orderBy: "createdAt",
        orderDirection: "desc",
      });

      // Update spent amounts for all budgets
      const updatedBudgets = await Promise.all(
        budgets.map(budget => updateBudgetSpentAmount(budget))
      );

      return response.status(200).json(createSuccessResponse(updatedBudgets));

    } catch (error: any) {
      console.error("Error getting user budgets:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get user budgets")
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