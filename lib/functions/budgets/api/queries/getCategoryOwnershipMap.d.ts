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
export declare const getCategoryOwnershipMap: import("firebase-functions/v2/https").CallableFunction<any, Promise<CategoryOwnershipResponse>, unknown>;
export {};
//# sourceMappingURL=getCategoryOwnershipMap.d.ts.map