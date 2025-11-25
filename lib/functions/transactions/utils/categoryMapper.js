"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapPlaidCategoryToFamilyCategory = mapPlaidCategoryToFamilyCategory;
exports.refreshCategoryCache = refreshCategoryCache;
exports.getCacheStats = getCacheStats;
const index_1 = require("../../../index");
const types_1 = require("../../../types");
const categoryCache = {
    categories: new Map(),
    lastRefreshed: 0,
    ttlMs: 5 * 60 * 1000 // 5 minutes TTL
};
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
async function mapPlaidCategoryToFamilyCategory(plaidCategories) {
    console.log(`🗂️ mapPlaidCategoryToFamilyCategory called with:`, plaidCategories);
    // If no categories provided, default to OTHER_EXPENSE
    if (!plaidCategories || plaidCategories.length === 0) {
        console.log(`  ⚠️ No Plaid categories provided, defaulting to OTHER_EXPENSE`);
        return types_1.TransactionCategory.OTHER_EXPENSE;
    }
    // Ensure cache is fresh
    await refreshCacheIfNeeded();
    // Extract primary and detailed categories
    const primaryCategory = plaidCategories[0]; // Could be "FOOD_AND_DRINK" or "Food and Drink"
    const detailedCategory = plaidCategories[1] || ''; // Could be "FOOD_AND_DRINK_FAST_FOOD" or "Fast Food"
    console.log(`  Primary: "${primaryCategory}", Detailed: "${detailedCategory}"`);
    // Try detailed category match first (most specific)
    if (detailedCategory) {
        const detailedMatch = categoryCache.categories.get(detailedCategory);
        if (detailedMatch) {
            console.log(`  ✅ Matched detailed category "${detailedCategory}" → ${detailedMatch}`);
            return detailedMatch;
        }
    }
    // Try primary category match
    const primaryMatch = categoryCache.categories.get(primaryCategory);
    if (primaryMatch) {
        console.log(`  ✅ Matched primary category "${primaryCategory}" → ${primaryMatch}`);
        return primaryMatch;
    }
    // Try case-insensitive keyword matching for legacy format
    if (categoryCache.categories.size > 0) {
        const allCategories = plaidCategories.join(' ').toLowerCase();
        console.log(`  🔎 No direct match, checking keywords in: "${allCategories}"`);
        // Check if any cached category key matches as a substring (case-insensitive)
        for (const [key, value] of categoryCache.categories.entries()) {
            if (allCategories.includes(key.toLowerCase())) {
                console.log(`  ✅ Keyword match: "${key}" → ${value}`);
                return value;
            }
        }
    }
    // No match found
    console.log(`  ⚠️ No match found for Plaid categories, defaulting to OTHER_EXPENSE`);
    return types_1.TransactionCategory.OTHER_EXPENSE;
}
/**
 * Refresh the category cache if TTL has expired
 */
async function refreshCacheIfNeeded() {
    const now = Date.now();
    const cacheAge = now - categoryCache.lastRefreshed;
    // Check if cache needs refresh
    if (categoryCache.categories.size === 0 || cacheAge > categoryCache.ttlMs) {
        console.log(`🔄 Refreshing category cache (age: ${cacheAge}ms, TTL: ${categoryCache.ttlMs}ms)`);
        await loadCategoriesFromFirestore();
    }
}
/**
 * Load all active categories from Firestore into cache
 */
async function loadCategoriesFromFirestore() {
    try {
        const categoriesSnapshot = await index_1.db.collection('categories')
            .where('isActive', '==', true)
            .get();
        console.log(`📚 Loaded ${categoriesSnapshot.size} active categories from Firestore`);
        // Clear existing cache
        categoryCache.categories.clear();
        // Build cache mapping
        categoriesSnapshot.forEach(doc => {
            const category = doc.data();
            const categoryId = doc.id;
            // Add primary_plaid_category mapping
            if (category.primary_plaid_category) {
                categoryCache.categories.set(category.primary_plaid_category, categoryId);
                console.log(`  📌 Cached: ${category.primary_plaid_category} → ${categoryId}`);
            }
            // Add detailed_plaid_category mapping (more specific)
            if (category.detailed_plaid_category) {
                categoryCache.categories.set(category.detailed_plaid_category, categoryId);
                console.log(`  📌 Cached: ${category.detailed_plaid_category} → ${categoryId}`);
            }
            // Also cache the category name for legacy format matching
            if (category.name) {
                categoryCache.categories.set(category.name, categoryId);
                console.log(`  📌 Cached: ${category.name} → ${categoryId}`);
            }
        });
        categoryCache.lastRefreshed = Date.now();
        console.log(`✅ Category cache refreshed with ${categoryCache.categories.size} mappings`);
    }
    catch (error) {
        console.error('Error loading categories from Firestore:', error);
        throw error;
    }
}
/**
 * Force refresh the category cache
 * Useful after category updates or for testing
 */
async function refreshCategoryCache() {
    console.log('🔄 Force refreshing category cache');
    await loadCategoriesFromFirestore();
}
/**
 * Get current cache statistics
 * Useful for debugging and monitoring
 */
function getCacheStats() {
    const now = Date.now();
    const ageMs = now - categoryCache.lastRefreshed;
    return {
        size: categoryCache.categories.size,
        ageMs,
        ttlMs: categoryCache.ttlMs,
        isExpired: ageMs > categoryCache.ttlMs
    };
}
//# sourceMappingURL=categoryMapper.js.map