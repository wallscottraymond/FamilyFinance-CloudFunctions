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

import { getFirestore } from 'firebase-admin/firestore';
import { Category } from '../../../types';

const db = getFirestore();

// Cache for active categories (5-minute TTL)
let categoriesCache: { data: CategoryInfo[]; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CategoryInfo {
  id: string;
  name: string;
  type: 'Income' | 'Outflow';
  /** first_category slug + label (Simplified-Transaction-Categories) — the user-facing level. */
  firstCategoryId: string | null;
  firstCategory: string | null;
  /** overall_category slug — a budget selecting an overall owns all its firsts. */
  overallCategoryId: string | null;
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

  // --- first_category-level ownership (Simplified-Transaction-Categories Phase 5) ---
  // The FE picks/greys at the `first_category` level, and budgets now store slugs
  // (`firstCategoryId`/`overallCategoryId`), which the detailed `ownership` above can't see.
  /** Map of firstCategoryId → owning (non-Everything-Else) budgetId, null if free. */
  ownershipByFirst: Record<string, string | null>;
  /** Map of firstCategoryId → first_category display label. */
  firstCategoryNames: Record<string, string>;
}

/**
 * Get all active categories from the system (cached)
 *
 * @returns Array of category info objects
 */
export async function getActiveCategories(): Promise<CategoryInfo[]> {
  // Check cache
  if (categoriesCache && Date.now() - categoriesCache.timestamp < CACHE_TTL) {
    return categoriesCache.data;
  }

  // Query Firestore
  const snapshot = await db.collection('categories')
    .where('isActive', '==', true)
    .get();

  const categories: CategoryInfo[] = [];
  snapshot.forEach((doc) => {
    const data = doc.data() as Category & {
      firstCategoryId?: string;
      first_category?: string;
      overallCategoryId?: string;
    };
    categories.push({
      id: doc.id,
      name: data.name,
      type: data.type,
      firstCategoryId: data.firstCategoryId ?? null,
      firstCategory: data.first_category ?? null,
      overallCategoryId: data.overallCategoryId ?? null,
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
export function clearCategoriesCache(): void {
  categoriesCache = null;
}

/**
 * Get all active budgets for a user
 *
 * @param userId - User ID to query budgets for
 * @returns Array of budget info objects
 */
export async function getUserBudgets(userId: string): Promise<BudgetInfo[]> {
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
  const budgetMap = new Map<string, BudgetInfo>();

  const processDocs = (snapshot: FirebaseFirestore.QuerySnapshot) => {
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
export async function getCategoryOwnership(
  userId: string
): Promise<CategoryOwnershipMap> {
  console.log(`[categoryOwnership] Getting category ownership for user ${userId}`);

  // 1. Get all active categories (system-wide, cached)
  const allCategories = await getActiveCategories();

  // 2. Get all user's active budgets
  const budgets = await getUserBudgets(userId);

  // 3. Build ownership map and name maps
  const ownership: Record<string, string | null> = {};
  const budgetNames: Record<string, string> = {};
  const categoryNames: Record<string, string> = {};
  let everythingElseBudgetId: string | null = null;

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

  // 5. First_category-level ownership (Phase 5). Budgets store slugs (firstCategoryId or
  //    overallCategoryId) or legacy detaileds; expand each to the firstCategoryIds it covers,
  //    keyed by firstCategoryId. Everything Else is skipped, so EE-owned firsts stay free.
  const firstCategoryNames: Record<string, string> = {};
  const ownershipByFirst: Record<string, string | null> = {};
  const firstByDetailed = new Map<string, string>();       // detailed doc id → firstCategoryId
  const firstsByOverall = new Map<string, Set<string>>();  // overallCategoryId → firstCategoryIds
  for (const cat of allCategories) {
    if (!cat.firstCategoryId) continue;
    ownershipByFirst[cat.firstCategoryId] = null;
    if (cat.firstCategory) firstCategoryNames[cat.firstCategoryId] = cat.firstCategory;
    firstByDetailed.set(cat.id, cat.firstCategoryId);
    if (cat.overallCategoryId) {
      let set = firstsByOverall.get(cat.overallCategoryId);
      if (!set) { set = new Set(); firstsByOverall.set(cat.overallCategoryId, set); }
      set.add(cat.firstCategoryId);
    }
  }
  const firstsCoveredBy = (categoryId: string): string[] => {
    if (ownershipByFirst.hasOwnProperty(categoryId)) return [categoryId];       // a firstCategoryId
    if (firstsByOverall.has(categoryId)) return [...firstsByOverall.get(categoryId)!]; // an overall slug
    const first = firstByDetailed.get(categoryId);                              // a legacy detailed
    return first ? [first] : [];
  };
  for (const budget of budgets) {
    if (budget.isSystemEverythingElse) continue;
    for (const categoryId of budget.categoryIds) {
      for (const firstId of firstsCoveredBy(categoryId)) {
        ownershipByFirst[firstId] = budget.id;
      }
    }
  }

  console.log(`[categoryOwnership] Result: ${allCategories.length} categories, ${unassignedCategoryIds.length} unassigned, ${Object.keys(ownershipByFirst).length} firsts, Everything Else: ${everythingElseBudgetId || 'NOT FOUND'}`);

  return {
    ownership,
    everythingElseBudgetId,
    allCategoryIds: allCategories.map(c => c.id),
    unassignedCategoryIds,
    budgetNames,
    categoryNames,
    ownershipByFirst,
    firstCategoryNames,
  };
}

/**
 * Get which budget currently owns a specific category
 *
 * @param userId - User ID
 * @param categoryId - Category ID to look up
 * @returns Budget ID that owns the category, or null if unassigned
 */
export async function getCategoryOwner(
  userId: string,
  categoryId: string
): Promise<string | null> {
  const ownershipMap = await getCategoryOwnership(userId);
  return ownershipMap.ownership[categoryId] ?? null;
}

/**
 * Check if any of the given categories are already assigned to another budget
 *
 * @param userId - User ID
 * @param categoryIds - Category IDs to check
 * @param excludeBudgetId - Budget ID to exclude from check (e.g., when updating a budget)
 * @returns Object with conflicts info
 */
export async function checkCategoryConflicts(
  userId: string,
  categoryIds: string[],
  excludeBudgetId?: string
): Promise<{
  hasConflicts: boolean;
  conflicts: Array<{ categoryId: string; categoryName: string; budgetId: string; budgetName: string }>;
}> {
  const ownershipMap = await getCategoryOwnership(userId);
  const conflicts: Array<{ categoryId: string; categoryName: string; budgetId: string; budgetName: string }> = [];

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
