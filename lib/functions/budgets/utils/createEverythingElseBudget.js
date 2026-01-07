"use strict";
/**
 * createEverythingElseBudget - System Budget Creation Utility
 *
 * Creates the "everything else" budget - a permanent catch-all budget that
 * captures transaction splits not assigned to any other budget.
 *
 * Key Characteristics:
 * - Auto-created for users on signup
 * - Cannot be deleted by users
 * - Amount is always $0 (calculated from spending)
 * - Name is editable, but other fields are not
 * - Lowest priority in transaction matching (fallback)
 *
 * @module budgets/utils/createEverythingElseBudget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEverythingElseBudget = createEverythingElseBudget;
const firestore_1 = require("firebase-admin/firestore");
const documentStructure_1 = require("../../../utils/documentStructure");
/**
 * Creates the "everything else" system budget for a user
 *
 * This budget acts as a catch-all for transactions that don't match any other budget.
 * It's automatically created on user signup and cannot be deleted.
 *
 * @param db - Firestore database instance
 * @param userId - User ID to create budget for
 * @param userCurrency - User's preferred currency (default: 'USD')
 * @returns Promise<string> - The created (or existing) budget document ID
 *
 * @throws Error if userId is missing or invalid
 * @throws Error if currency format is invalid
 * @throws Error if Firestore operation fails
 *
 * @example
 * ```typescript
 * // Create budget for new user
 * const budgetId = await createEverythingElseBudget(db, 'user-123', 'USD');
 *
 * // Budget will be created with:
 * // - isSystemEverythingElse: true
 * // - name: 'Everything Else'
 * // - amount: 0
 * // - categoryIds: [] (catches all categories)
 * ```
 */
async function createEverythingElseBudget(db, userId, userCurrency = 'USD') {
    // === INPUT VALIDATION ===
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
        throw new Error('userId is required and must be a non-empty string');
    }
    if (!userCurrency || userCurrency.length !== 3) {
        throw new Error('currency must be a valid 3-letter code (e.g., USD, EUR, GBP)');
    }
    // === IDEMPOTENCY CHECK ===
    // Check if user already has an "everything else" budget
    try {
        const existingBudgetQuery = await db
            .collection('budgets')
            .where('userId', '==', userId)
            .where('isSystemEverythingElse', '==', true)
            .limit(1)
            .get();
        if (!existingBudgetQuery.empty) {
            const existingBudget = existingBudgetQuery.docs[0];
            console.log(`✅ Use
      r ${userId} already has "everything else" budget: ${existingBudget.id}`);
            return existingBudget.id;
        }
    }
    catch (error) {
        console.error(`❌ Error checking for existing "everything else" budget:`, error);
        throw error;
    }
    // === CREATE NEW BUDGET ===
    const now = firestore_1.Timestamp.now();
    const groupIds = []; // Personal budget (not shared)
    const budgetData = {
        // === ROOT-LEVEL QUERY FIELDS ===
        userId,
        groupIds,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        // === NESTED ACCESS CONTROL ===
        access: (0, documentStructure_1.buildAccessControl)(userId, userId, groupIds),
        // === SYSTEM BUDGET IDENTIFICATION ===
        isSystemEverythingElse: true,
        // === BUDGET CONFIGURATION ===
        name: 'Everything Else',
        amount: 0, // Always zero - calculated from spending
        currency: userCurrency,
        categoryIds: [], // Empty = catches all categories
        period: 'monthly', // Monthly tracking periods
        startDate: now,
        endDate: now, // Legacy field for compatibility
        spent: 0,
        remaining: 0,
        alertThreshold: 80, // Standard threshold
        // === BUDGET TYPE CONFIGURATION ===
        budgetType: 'recurring',
        isOngoing: true, // Never ends
        // budgetEndDate intentionally undefined - ongoing budget
    };
    try {
        const budgetRef = await db.collection('budgets').add(budgetData);
        console.log(`✅ Created "everything else" budget for user ${userId}: ${budgetRef.id}`);
        return budgetRef.id;
    }
    catch (error) {
        console.error(`❌ Error creating "everything else" budget for user ${userId}:`, error);
        throw error;
    }
}
//# sourceMappingURL=createEverythingElseBudget.js.map