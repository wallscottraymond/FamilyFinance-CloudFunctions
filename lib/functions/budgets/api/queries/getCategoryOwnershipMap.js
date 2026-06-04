"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCategoryOwnershipMap = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const auth_1 = require("../../../../utils/auth");
const cors_1 = require("../../../../middleware/cors");
const categoryOwnership_1 = require("../../utils/categoryOwnership");
/**
 * Get category ownership map for the authenticated user
 */
exports.getCategoryOwnershipMap = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "GET") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only GET requests are allowed"));
        }
        try {
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            const userId = user.id;
            console.log(`[getCategoryOwnershipMap] Fetching ownership map for user: ${userId}`);
            // Get category ownership data
            const ownershipMap = await (0, categoryOwnership_1.getCategoryOwnership)(userId);
            // Get budget names for display
            const budgets = await (0, categoryOwnership_1.getUserBudgets)(userId);
            const budgetNames = {};
            for (const budget of budgets) {
                budgetNames[budget.id] = budget.name;
            }
            // Get category names for display
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
                unassignedCount: ownershipMap.unassignedCategoryIds.length,
                totalCategories: ownershipMap.allCategoryIds.length,
            };
            console.log(`[getCategoryOwnershipMap] Returning ${result.totalCategories} categories, ${result.unassignedCount} unassigned`);
            return response.status(200).json((0, auth_1.createSuccessResponse)(result));
        }
        catch (error) {
            console.error("[getCategoryOwnershipMap] Error:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to get category ownership map"));
        }
    });
});
//# sourceMappingURL=getCategoryOwnershipMap.js.map