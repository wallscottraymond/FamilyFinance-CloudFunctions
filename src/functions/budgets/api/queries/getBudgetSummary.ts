import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  Budget,
  UserRole
} from "../../../../types";
import {
  getDocument,
  queryDocuments
} from "../../../../utils/firestore";
import {
  authenticateRequest,
  checkFamilyAccess
} from "../../../../utils/auth";

/**
 * Get budget spending summary.
 *
 * Callable (onCall): use the Firebase Functions SDK (httpsCallable). Returns the
 * summary object directly. Pass `{ id: budgetId }` in the callable payload.
 */
export const getBudgetSummary = onCall({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request) => {
  const budgetId = (request.data?.id as string) || "";
  if (!budgetId) {
    throw new HttpsError("invalid-argument", "Budget ID is required");
  }

  // Authenticate (callable-aware helper reads request.auth)
  let userData;
  try {
    ({ userData } = await authenticateRequest(request, UserRole.VIEWER));
  } catch (error: any) {
    throw new HttpsError("unauthenticated", error?.message || "Authentication required");
  }

  try {
    // Get budget
    const budget = await getDocument<Budget>("budgets", budgetId);
    if (!budget) {
      throw new HttpsError("not-found", "Budget not found");
    }

    // Check access - for individual budgets check ownership/membership, for shared budgets check family access
    if (budget.isShared && budget.familyId) {
      // Shared budget - check family access
      if (!await checkFamilyAccess(userData.id!, budget.familyId)) {
        throw new HttpsError("permission-denied", "Cannot access this family budget");
      }
    } else {
      // Individual budget - check ownership or membership
      if (budget.createdBy !== userData.id! && !(budget.memberIds || []).includes(userData.id!)) {
        throw new HttpsError("permission-denied", "Cannot access this budget");
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
          categoryIds: budget.categoryIds,
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

      return summary;

  } catch (error: any) {
    // Preserve intentional HttpsErrors (not-found, permission-denied, …)
    if (error instanceof HttpsError) throw error;
    console.error("Error getting budget summary:", error);
    throw new HttpsError("internal", "Failed to get budget summary");
  }
});