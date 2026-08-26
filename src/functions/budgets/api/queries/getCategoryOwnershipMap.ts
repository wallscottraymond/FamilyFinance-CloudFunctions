/**
 * Get Category Ownership Map (callable)
 *
 * Returns which budget owns each category for the authenticated user. Consumed by the mobile
 * app via `httpsCallable('getCategoryOwnershipMap')` — so this MUST be an `onCall`, not an
 * `onRequest` (the previous onRequest silently failed the callable protocol → the budget-wizard
 * grey-out never received ownership data).
 *
 * Response:
 * - ownership: categoryId (detailed doc id) → budgetId (null if unassigned)
 * - ownershipByFirst: firstCategoryId → owning non-EE budgetId (Phase 5 grey-out)
 * - budgetNames / categoryNames / firstCategoryNames: display maps
 * - everythingElseBudgetId, unassignedCount, totalCategories
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  getCategoryOwnership,
  getActiveCategories,
  getUserBudgets,
} from "../../utils/categoryOwnership";

interface CategoryOwnershipResponse {
  ownership: Record<string, string | null>;
  budgetNames: Record<string, string>;
  categoryNames: Record<string, string>;
  everythingElseBudgetId: string | null;
  ownershipByFirst: Record<string, string | null>;
  firstCategoryNames: Record<string, string>;
  unassignedCount: number;
  totalCategories: number;
}

export const getCategoryOwnershipMap = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30 },
  async (request): Promise<CategoryOwnershipResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const userId = request.auth.uid;

    try {
      console.log(`[getCategoryOwnershipMap] Fetching ownership map for user: ${userId}`);

      const ownershipMap = await getCategoryOwnership(userId);

      const budgets = await getUserBudgets(userId);
      const budgetNames: Record<string, string> = {};
      for (const budget of budgets) {
        budgetNames[budget.id] = budget.name;
      }

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
        ownershipByFirst: ownershipMap.ownershipByFirst,
        firstCategoryNames: ownershipMap.firstCategoryNames,
        unassignedCount: ownershipMap.unassignedCategoryIds.length,
        totalCategories: ownershipMap.allCategoryIds.length,
      };

      console.log(
        `[getCategoryOwnershipMap] Returning ${result.totalCategories} categories, ` +
          `${result.unassignedCount} unassigned, ${Object.keys(result.ownershipByFirst).length} firsts`
      );

      return result;
    } catch (error) {
      console.error("[getCategoryOwnershipMap] Error:", error);
      throw new HttpsError("internal", "Failed to get category ownership map");
    }
  }
);
