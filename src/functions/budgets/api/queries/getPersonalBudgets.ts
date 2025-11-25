import { onRequest } from "firebase-functions/v2/https";
import {
  Budget,
  UserRole,
  WhereClause
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
 * Get personal budgets for individual users (not family-based)
 * This function works for users regardless of family membership
 */
export const getPersonalBudgets = onRequest({
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

      // Parse query parameters for filtering
      const { startDate, endDate, category, isActive } = request.query;

      // Build query conditions
      const whereConditions: WhereClause[] = [
        { field: "createdBy", operator: "==", value: user.id },
      ];

      // Add optional filters
      if (startDate) {
        whereConditions.push({
          field: "startDate",
          operator: ">=",
          value: startDate as string
        });
      }

      if (endDate) {
        whereConditions.push({
          field: "endDate",
          operator: "<=",
          value: endDate as string
        });
      }

      if (category) {
        whereConditions.push({
          field: "categoryIds",
          operator: "array-contains",
          value: category as string
        });
      }

      if (isActive !== undefined) {
        whereConditions.push({
          field: "isActive",
          operator: "==",
          value: isActive === 'true'
        });
      }

      // Query personal budgets created by this user
      const budgets = await queryDocuments<Budget>("budgets", {
        where: whereConditions,
        orderBy: "createdAt",
        orderDirection: "desc",
      });

      console.log(`[getPersonalBudgets] Found ${budgets.length} personal budgets for user ${user.id}`);

      // Update spent amounts for all budgets (optional - can be disabled for performance)
      const updatedBudgets = await Promise.all(
        budgets.map(budget => updateBudgetSpentAmount(budget))
      );

      return response.status(200).json(createSuccessResponse(updatedBudgets));

    } catch (error: any) {
      console.error("Error getting personal budgets:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get personal budgets")
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