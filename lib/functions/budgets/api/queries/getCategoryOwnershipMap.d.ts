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
/**
 * Get category ownership map for the authenticated user
 */
export declare const getCategoryOwnershipMap: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=getCategoryOwnershipMap.d.ts.map