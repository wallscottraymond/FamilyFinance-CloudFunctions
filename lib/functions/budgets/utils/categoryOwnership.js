"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveCategories = getActiveCategories;
exports.clearCategoriesCache = clearCategoriesCache;
exports.getUserBudgets = getUserBudgets;
exports.getCategoryOwnership = getCategoryOwnership;
exports.getCategoryOwner = getCategoryOwner;
exports.checkCategoryConflicts = checkCategoryConflicts;
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
// Cache for active categories (5-minute TTL)
let categoriesCache = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
/**
 * Get all active categories from the system (cached)
 *
 * @returns Array of category info objects
 */
async function getActiveCategories() {
    // Check cache
    if (categoriesCache && Date.now() - categoriesCache.timestamp < CACHE_TTL) {
        return categoriesCache.data;
    }
    // Query Firestore
    const snapshot = await db.collection('categories')
        .where('isActive', '==', true)
        .get();
    const categories = [];
    snapshot.forEach((doc) => {
        const data = doc.data();
        categories.push({
            id: doc.id,
            name: data.name,
            type: data.type,
        });
    });
    // Update cache
    categoriesCache = {
        data: categories,
        timestamp: Date.now(),
    };
    console.log(`[categoryOwnership] Loaded ${categories.length} active categories`);
    return categories;
}
/**
 * Clear the categories cache (useful for testing)
 */
function clearCategoriesCache() {
    categoriesCache = null;
}
/**
 * Get all active budgets for a user
 *
 * @param userId - User ID to query budgets for
 * @returns Array of budget info objects
 */
async function getUserBudgets(userId) {
    // Query by both createdBy (new RBAC) and userId (legacy) for compatibility
    const [createdBySnapshot, userIdSnapshot] = await Promise.all([
        db.collection('budgets')
            .where('createdBy', '==', userId)
            .where('isActive', '==', true)
            .get(),
        db.collection('budgets')
            .where('userId', '==', userId)
            .where('isActive', '==', true)
            .get(),
    ]);
    // Merge and deduplicate by document ID
    const budgetMap = new Map();
    const processDocs = (snapshot) => {
        snapshot.forEach((doc) => {
            if (!budgetMap.has(doc.id)) {
                const data = doc.data();
                budgetMap.set(doc.id, {
                    id: doc.id,
                    name: data.name || 'Unnamed Budget',
                    categoryIds: data.categoryIds || [],
                    isSystemEverythingElse: data.isSystemEverythingElse === true,
                });
            }
        });
    };
    processDocs(createdBySnapshot);
    processDocs(userIdSnapshot);
    const budgets = Array.from(budgetMap.values());
    console.log(`[categoryOwnership] Found ${budgets.length} active budgets for user ${userId}`);
    return budgets;
}
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
async function getCategoryOwnership(userId) {
    console.log(`[categoryOwnership] Getting category ownership for user ${userId}`);
    // 1. Get all active categories (system-wide, cached)
    const allCategories = await getActiveCategories();
    // 2. Get all user's active budgets
    const budgets = await getUserBudgets(userId);
    // 3. Build ownership map and name maps
    const ownership = {};
    const budgetNames = {};
    const categoryNames = {};
    let everythingElseBudgetId = null;
    // Initialize all categories as unassigned
    for (const cat of allCategories) {
        ownership[cat.id] = null;
        categoryNames[cat.id] = cat.name;
    }
    // Process budgets
    for (const budget of budgets) {
        budgetNames[budget.id] = budget.name;
        if (budget.isSystemEverythingElse) {
            everythingElseBudgetId = budget.id;
            // Don't process Everything Else's categoryIds for ownership
            // (it should own all unassigned categories, but we track that separately)
            continue;
        }
        // Assign categories to this budget
        for (const categoryId of budget.categoryIds) {
            if (ownership.hasOwnProperty(categoryId)) {
                ownership[categoryId] = budget.id;
            }
        }
    }
    // 4. Calculate unassigned categories
    const unassignedCategoryIds = Object.entries(ownership)
        .filter(([_, budgetId]) => budgetId === null)
        .map(([categoryId, _]) => categoryId);
    console.log(`[categoryOwnership] Result: ${allCategories.length} categories, ${unassignedCategoryIds.length} unassigned, Everything Else: ${everythingElseBudgetId || 'NOT FOUND'}`);
    return {
        ownership,
        everythingElseBudgetId,
        allCategoryIds: allCategories.map(c => c.id),
        unassignedCategoryIds,
        budgetNames,
        categoryNames,
    };
}
/**
 * Get which budget currently owns a specific category
 *
 * @param userId - User ID
 * @param categoryId - Category ID to look up
 * @returns Budget ID that owns the category, or null if unassigned
 */
async function getCategoryOwner(userId, categoryId) {
    var _a;
    const ownershipMap = await getCategoryOwnership(userId);
    return (_a = ownershipMap.ownership[categoryId]) !== null && _a !== void 0 ? _a : null;
}
/**
 * Check if any of the given categories are already assigned to another budget
 *
 * @param userId - User ID
 * @param categoryIds - Category IDs to check
 * @param excludeBudgetId - Budget ID to exclude from check (e.g., when updating a budget)
 * @returns Object with conflicts info
 */
async function checkCategoryConflicts(userId, categoryIds, excludeBudgetId) {
    const ownershipMap = await getCategoryOwnership(userId);
    const conflicts = [];
    for (const categoryId of categoryIds) {
        const ownerId = ownershipMap.ownership[categoryId];
        if (ownerId && ownerId !== excludeBudgetId) {
            conflicts.push({
                categoryId,
                categoryName: ownershipMap.categoryNames[categoryId] || categoryId,
                budgetId: ownerId,
                budgetName: ownershipMap.budgetNames[ownerId] || ownerId,
            });
        }
    }
    return {
        hasConflicts: conflicts.length > 0,
        conflicts,
    };
}
//# sourceMappingURL=categoryOwnership.js.map