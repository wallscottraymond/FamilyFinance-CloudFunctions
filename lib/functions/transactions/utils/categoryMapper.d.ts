/**
 * Category Mapper Utility
 *
 * Maps Plaid categories to Family Finance category IDs using the categories collection in Firestore.
 * This provides a flexible, database-driven approach where category mappings can be managed
 * without code changes.
 *
 * The mapper supports both:
 * - New Plaid format: personal_finance_category { primary, detailed }
 * - Legacy Plaid format: category array (e.g., ["Food and Drink", "Restaurants"])
 */
/**
 * Map Plaid categories to Family Finance category ID
 *
 * Looks up categories in Firestore using:
 * 1. detailed_plaid_category match (most specific)
 * 2. primary_plaid_category match (fallback)
 * 3. Default to OTHER_EXPENSE if no match
 *
 * @param plaidCategories - Array of Plaid category strings [primary, detailed] or legacy format
 * @returns Family Finance category ID from categories collection
 */
export declare function mapPlaidCategoryToFamilyCategory(plaidCategories: string[] | null): Promise<string>;
/**
 * Force refresh the category cache
 * Useful after category updates or for testing
 */
export declare function refreshCategoryCache(): Promise<void>;
/**
 * Get current cache statistics
 * Useful for debugging and monitoring
 */
export declare function getCacheStats(): {
    size: number;
    ageMs: number;
    ttlMs: number;
    isExpired: boolean;
};
//# sourceMappingURL=categoryMapper.d.ts.map