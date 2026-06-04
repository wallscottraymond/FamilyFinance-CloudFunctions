/**
 * Category Ownership Utility
 *
 * Provides functions to determine which budget owns each category for a user.
 * Categories are system-wide, but ownership is per-user (each user's budgets
 * can claim different categories).
 *
 * Used by:
 * - createBudget.ts - to transfer categories from "Everything Else"
 * - updateBudget.ts - to handle category additions/removals
 * - deleteBudget.ts - to return categories to "Everything Else"
 *
 * @module budgets/utils/categoryOwnership
 */
interface CategoryInfo {
    id: string;
    name: string;
    type: 'Income' | 'Outflow';
}
interface BudgetInfo {
    id: string;
    name: string;
    categoryIds: string[];
    isSystemEverythingElse: boolean;
}
/**
 * Category ownership map for a user
 */
export interface CategoryOwnershipMap {
    /** Map of categoryId → budgetId (null if unassigned to any regular budget) */
    ownership: Record<string, string | null>;
    /** The "Everything Else" budget ID (null if doesn't exist) */
    everythingElseBudgetId: string | null;
    /** All category IDs in the system */
    allCategoryIds: string[];
    /** Categories not assigned to any regular budget (should be owned by Everything Else) */
    unassignedCategoryIds: string[];
    /** Map of budgetId → budget name (for display purposes) */
    budgetNames: Record<string, string>;
    /** Map of categoryId → category name (for display purposes) */
    categoryNames: Record<string, string>;
}
/**
 * Get all active categories from the system (cached)
 *
 * @returns Array of category info objects
 */
export declare function getActiveCategories(): Promise<CategoryInfo[]>;
/**
 * Clear the categories cache (useful for testing)
 */
export declare function clearCategoriesCache(): void;
/**
 * Get all active budgets for a user
 *
 * @param userId - User ID to query budgets for
 * @returns Array of budget info objects
 */
export declare function getUserBudgets(userId: string): Promise<BudgetInfo[]>;
/**
 * Get category ownership map for a user
 *
 * Returns which budget owns each category for this user.
 * Categories not assigned to any regular budget are considered "unassigned"
 * and should be owned by the "Everything Else" budget.
 *
 * @param userId - User ID to get ownership map for
 * @returns CategoryOwnershipMap with ownership details
 */
export declare function getCategoryOwnership(userId: string): Promise<CategoryOwnershipMap>;
/**
 * Get which budget currently owns a specific category
 *
 * @param userId - User ID
 * @param categoryId - Category ID to look up
 * @returns Budget ID that owns the category, or null if unassigned
 */
export declare function getCategoryOwner(userId: string, categoryId: string): Promise<string | null>;
/**
 * Check if any of the given categories are already assigned to another budget
 *
 * @param userId - User ID
 * @param categoryIds - Category IDs to check
 * @param excludeBudgetId - Budget ID to exclude from check (e.g., when updating a budget)
 * @returns Object with conflicts info
 */
export declare function checkCategoryConflicts(userId: string, categoryIds: string[], excludeBudgetId?: string): Promise<{
    hasConflicts: boolean;
    conflicts: Array<{
        categoryId: string;
        categoryName: string;
        budgetId: string;
        budgetName: string;
    }>;
}>;
export {};
//# sourceMappingURL=categoryOwnership.d.ts.map