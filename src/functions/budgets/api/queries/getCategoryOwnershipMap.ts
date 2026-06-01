/**
 * Get Category Ownership Map
 *
 * Returns which budget owns each category for the authenticated user.
 * Used by mobile app to visualize and manage category assignments.
 *
 * Response includes:
 * - ownership: Map of categoryId → budgetId (null if unassigned)
 * - budgetNames: Map of budgetId → budget display name
 * - categoryNames: Map of categoryId → category display name
 * - everythingElseBudgetId: The "Everything Else" system budget ID
 * - unassignedCount: Number of categories not assigned to any budget
 */

import { onRequest } from "firebase-functions/v2/https";
import { UserRole } from "../../../../types";
import {
  authMiddleware,
  createErrorResponse,
  createSuccessResponse,
} from "../../../../utils/auth";
import { firebaseCors } from "../../../../middleware/cors";
import {
  getCategoryOwnership,
  getActiveCategories,
  getUserBudgets,
} from "../../utils/categoryOwnership";

/**
 * Response shape for getCategoryOwnershipMap
 */
interface CategoryOwnershipResponse {
  /** Map of categoryId → budgetId (null if unassigned) */
  ownership: Record<string, string | null>;
  /** Map of budgetId → budget name */
  budgetNames: Record<string, string>;
  /** Map of categoryId → category name */
  categoryNames: Record<string, string>;
  /** The "Everything Else" budget ID */
  everythingElseBudgetId: string | null;
  /** Count of unassigned categories */
  unassignedCount: number;
  /** Total categories in system */
  totalCategories: number;
}

/**
 * Get category ownership map for the authenticated user
 */
export const getCategoryOwnershipMap = onRequest({
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
      const userId = user.id!;

      console.log(`[getCategoryOwnershipMap] Fetching ownership map for user: ${userId}`);

      // Get category ownership data
      const ownershipMap = await getCategoryOwnership(userId);

      // Get budget names for display
      const budgets = await getUserBudgets(userId);
      const budgetNames: Record<string, string> = {};
      for (const budget of budgets) {
        budgetNames[budget.id] = budget.name;
      }

      // Get category names for display
      const categories = await getActiveCategories();
      const categoryNames: Record<string, string> = {};
      for (const cat of categories) {
        categoryNames[cat.id] = cat.name;
      }

      const result: CategoryOwnershipResponse = {
        ownership: ownershipMap.ownership,
        budgetNames,
        categoryNames,
        everythingElseBudgetId: ownershipMap.everythingElseBudgetId,
        unassignedCount: ownershipMap.unassignedCategoryIds.length,
        totalCategories: ownershipMap.allCategoryIds.length,
      };

      console.log(`[getCategoryOwnershipMap] Returning ${result.totalCategories} categories, ${result.unassignedCount} unassigned`);

      return response.status(200).json(createSuccessResponse(result));

    } catch (error: any) {
      console.error("[getCategoryOwnershipMap] Error:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get category ownership map")
      );
    }
  });
});
