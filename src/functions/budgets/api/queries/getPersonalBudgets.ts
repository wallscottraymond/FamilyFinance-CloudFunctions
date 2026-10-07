import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  Budget,
  UserRole,
  WhereClause
} from "../../../../types";
import {
  queryDocuments,
  updateDocument
} from "../../../../utils/firestore";
import { authenticateRequest } from "../../../../utils/auth";

/**
 * Get personal budgets for individual users (not family-based)
 * This function works for users regardless of family membership.
 *
 * Callable (onCall): use the Firebase Functions SDK (httpsCallable) — the client
 * no longer hand-builds URLs or attaches tokens. Returns the Budget[] directly.
 */
const toMs = (v: unknown): number => {
  const t = v as { toMillis?: () => number } | string | null | undefined;
  if (t && typeof t === "object" && typeof t.toMillis === "function") return t.toMillis();
  return t ? new Date(t as string).getTime() || 0 : 0;
};

export const getPersonalBudgets = onCall({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request): Promise<Budget[]> => {
  // Authenticate (callable-aware helper reads request.auth)
  let userData;
  try {
    ({ userData } = await authenticateRequest(request, UserRole.VIEWER));
  } catch (error: any) {
    throw new HttpsError("unauthenticated", error?.message || "Authentication required");
  }

  try {
    // Optional filters from the callable payload
    const { startDate, endDate, category, isActive } = (request.data || {}) as {
      startDate?: string; endDate?: string; category?: string; isActive?: string | boolean;
    };

    // Build query conditions
    const whereConditions: WhereClause[] = [
      // Owner = the budget's current owner (userId), not its creator (security audit 2026-10-07).
      { field: "userId", operator: "==", value: userData.id },
    ];

    if (startDate) {
      whereConditions.push({ field: "startDate", operator: ">=", value: startDate });
    }

    if (endDate) {
      whereConditions.push({ field: "endDate", operator: "<=", value: endDate });
    }

    if (category) {
      whereConditions.push({ field: "categoryIds", operator: "array-contains", value: category });
    }

    if (isActive !== undefined) {
      whereConditions.push({
        field: "isActive",
        operator: "==",
        value: isActive === true || isActive === 'true'
      });
    }

    // Query personal budgets created by this user
    // Newest first, sorted in memory (no composite index needed for the userId filter).
    const budgets = (await queryDocuments<Budget>("budgets", { where: whereConditions })).sort(
      (a, b) => toMs((b as { createdAt?: unknown }).createdAt) - toMs((a as { createdAt?: unknown }).createdAt)
    );

    console.log(`[getPersonalBudgets] Found ${budgets.length} personal budgets for user ${userData.id}`);

    // Update spent amounts for all budgets (optional - can be disabled for performance)
    const updatedBudgets = await Promise.all(
      budgets.map(budget => updateBudgetSpentAmount(budget))
    );

    return updatedBudgets;

  } catch (error: any) {
    console.error("Error getting personal budgets:", error);
    throw new HttpsError("internal", "Failed to get personal budgets");
  }
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