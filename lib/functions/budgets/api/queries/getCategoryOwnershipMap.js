"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCategoryOwnershipMap = void 0;
const https_1 = require("firebase-functions/v2/https");
const categoryOwnership_1 = require("../../utils/categoryOwnership");
exports.getCategoryOwnershipMap = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ region: "us-central1", memory: "256MiB", timeoutSeconds: 30 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const userId = request.auth.uid;
    try {
        console.log(`[getCategoryOwnershipMap] Fetching ownership map for user: ${userId}`);
        const ownershipMap = await (0, categoryOwnership_1.getCategoryOwnership)(userId);
        const budgets = await (0, categoryOwnership_1.getUserBudgets)(userId);
        const budgetNames = {};
        for (const budget of budgets) {
            budgetNames[budget.id] = budget.name;
        }
        const categories = await (0, categoryOwnership_1.getActiveCategories)();
        const categoryNames = {};
        for (const cat of categories) {
            categoryNames[cat.id] = cat.name;
        }
        const result = {
            ownership: ownershipMap.ownership,
            budgetNames,
            categoryNames,
            everythingElseBudgetId: ownershipMap.everythingElseBudgetId,
            ownershipByFirst: ownershipMap.ownershipByFirst,
            firstCategoryNames: ownershipMap.firstCategoryNames,
            unassignedCount: ownershipMap.unassignedCategoryIds.length,
            totalCategories: ownershipMap.allCategoryIds.length,
        };
        console.log(`[getCategoryOwnershipMap] Returning ${result.totalCategories} categories, ` +
            `${result.unassignedCount} unassigned, ${Object.keys(result.ownershipByFirst).length} firsts`);
        return result;
    }
    catch (error) {
        console.error("[getCategoryOwnershipMap] Error:", error);
        throw new https_1.HttpsError("internal", "Failed to get category ownership map");
    }
});
//# sourceMappingURL=getCategoryOwnershipMap.js.map