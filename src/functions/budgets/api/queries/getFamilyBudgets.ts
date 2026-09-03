import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  Budget,
  UserRole
} from "../../../../types";
import {
  queryDocuments,
  updateDocument
} from "../../../../utils/firestore";
import { authenticateRequest } from "../../../../utils/auth";

/**
 * Get family budgets.
 *
 * Callable (onCall): use the Firebase Functions SDK (httpsCallable). Returns the
 * Budget[] directly. Users without a family get a `failed-precondition` error whose
 * message contains "User must belong to a family" — the client detects this and
 * falls back to personal budgets.
 */
export const getFamilyBudgets = onCall({
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

  if (!userData.familyId) {
    // Message preserved for the client's no-family fallback detection
    throw new HttpsError("failed-precondition", "User must belong to a family");
  }

  try {
    const data = (request.data || {}) as { includeInactive?: boolean | string; limit?: number; offset?: number };
    const includeInactive = data.includeInactive === true || data.includeInactive === "true";
    const limit = Number(data.limit) || 50;
    const offset = Number(data.offset) || 0;

    // Build query conditions
    const whereConditions = [
      { field: "familyId", operator: "==" as const, value: userData.familyId },
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

    return updatedBudgets;

  } catch (error: any) {
    console.error("Error getting family budgets:", error);
    throw new HttpsError("internal", "Failed to get family budgets");
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