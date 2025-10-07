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
 * Get family budgets
 */
export const getFamilyBudgets = onRequest({
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

      if (!user.familyId) {
        return response.status(400).json(
          createErrorResponse("no-family", "User must belong to a family")
        );
      }

      const includeInactive = request.query.includeInactive === "true";
      const limit = parseInt(request.query.limit as string) || 50;
      const offset = parseInt(request.query.offset as string) || 0;

      // Build query conditions
      const whereConditions = [
        { field: "familyId", operator: "==" as const, value: user.familyId },
      ];

      if (!includeInactive) {
        whereConditions.push({ field: "isActive", operator: "==" as const, value: "true" });
      }

      // Query budgets
      const budgets = await queryDocuments<Budget>("budgets", {
        where: whereConditions,
        orderBy: "createdAt",
        orderDirection: "desc",
        limit,
        offset,
      });

      // Update spent amounts for all budgets
      const updatedBudgets = await Promise.all(
        budgets.map(budget => updateBudgetSpentAmount(budget))
      );

      return response.status(200).json(createSuccessResponse(updatedBudgets));

    } catch (error: any) {
      console.error("Error getting family budgets:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get family budgets")
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