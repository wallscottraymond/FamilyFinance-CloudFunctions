import { onRequest } from "firebase-functions/v2/https";
import { 
  Budget, 
  UserRole
} from "../../types";
import { 
  getDocument, 
  queryDocuments
} from "../../utils/firestore";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse,
  checkFamilyAccess 
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Get budget spending summary
 */
export const getBudgetSummary = onRequest({
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
        if (budget.createdBy !== user.id! && !budget.memberIds.includes(user.id!)) {
          return response.status(403).json(
            createErrorResponse("access-denied", "Cannot access this budget")
          );
        }
      }

      // Get transactions for this budget
      const transactions = await queryDocuments("transactions", {
        where: [
          { field: "budgetId", operator: "==", value: budgetId },
          { field: "status", operator: "==", value: "approved" },
          { field: "type", operator: "==", value: "expense" },
        ],
        orderBy: "date",
        orderDirection: "desc",
      });

      // Calculate spending by member
      const spendingByMember: Record<string, { amount: number; transactionCount: number }> = {};
      let totalSpent = 0;

      transactions.forEach((transaction: any) => {
        const userId = transaction.userId;
        const amount = transaction.amount;

        if (!spendingByMember[userId]) {
          spendingByMember[userId] = { amount: 0, transactionCount: 0 };
        }

        spendingByMember[userId].amount += amount;
        spendingByMember[userId].transactionCount += 1;
        totalSpent += amount;
      });

      // Get member details
      const memberIds = Object.keys(spendingByMember);
      const memberPromises = memberIds.map(id => getDocument("users", id));
      const members = await Promise.all(memberPromises);

      const spendingSummary = memberIds.map((memberId, index) => ({
        user: {
          id: memberId,
          displayName: (members[index] as any)?.displayName || "Unknown",
          email: (members[index] as any)?.email || "Unknown",
        },
        spending: spendingByMember[memberId],
        percentage: totalSpent > 0 ? (spendingByMember[memberId].amount / totalSpent) * 100 : 0,
      }));

      const summary = {
        budget: {
          id: budget.id,
          name: budget.name,
          amount: budget.amount,
          currency: budget.currency,
          period: budget.period,
          category: budget.category,
        },
        spending: {
          total: totalSpent,
          remaining: budget.amount - totalSpent,
          percentage: (totalSpent / budget.amount) * 100,
          isOverBudget: totalSpent > budget.amount,
          alertThresholdReached: (totalSpent / budget.amount) * 100 >= budget.alertThreshold,
        },
        transactions: {
          count: transactions.length,
          recent: transactions.slice(0, 5), // Last 5 transactions
        },
        members: spendingSummary,
      };

      return response.status(200).json(createSuccessResponse(summary));

    } catch (error: any) {
      console.error("Error getting budget summary:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get budget summary")
      );
    }
  });
});