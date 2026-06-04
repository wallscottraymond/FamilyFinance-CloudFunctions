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
 * - Owns ALL categories by default (transferred away when regular budgets are created)
 *
 * @module budgets/utils/createEverythingElseBudget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEverythingElseBudget = createEverythingElseBudget;
const firestore_1 = require("firebase-admin/firestore");
const documentStructure_1 = require("../../../utils/documentStructure");
const categoryOwnership_1 = require("./categoryOwnership");
const job_queue_1 = require("../../infrastructure/job_queue");
const observability_1 = require("../../observability");
const budgets_1 = require("../../domain/budgets");
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
 * // - categoryIds: [ALL_ACTIVE_CATEGORY_IDS]
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
            console.log(`✅ User ${userId} already has "everything else" budget: ${existingBudget.id}`);
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
    // Fetch all active categories - Everything Else owns ALL categories by default
    const allCategories = await (0, categoryOwnership_1.getActiveCategories)();
    const allCategoryIds = allCategories.map(c => c.id);
    console.log(`📋 Populating "Everything Else" with ${allCategoryIds.length} categories`);
    const budgetData = {
        // === ROOT-LEVEL QUERY FIELDS ===
        userId,
        groupIds,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        // === RBAC FIELDS (must match createBudget.ts structure) ===
        createdBy: userId,
        ownerId: userId,
        isPrivate: true,
        // === NESTED ACCESS CONTROL ===
        access: (0, documentStructure_1.buildAccessControl)(userId, userId, groupIds),
        // === SYSTEM BUDGET IDENTIFICATION ===
        isSystemEverythingElse: true,
        // === BUDGET CONFIGURATION ===
        name: 'Everything Else',
        amount: 0, // Always zero - calculated from spending
        currency: userCurrency,
        categoryIds: allCategoryIds, // Owns ALL categories by default
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
        // Generate the budget's periods + summaries via the v2 cascade. Without
        // this the EE budget has no budget_periods, so it never renders in the app
        // and the assignment engine has nowhere to record spend. Non-blocking:
        // a failure here is recoverable via the assignment backfill's heal pass.
        try {
            const cascade_payload = (0, budgets_1.build_self_provision_budget_created_payload)({
                budget_id: budgetRef.id,
                user_id: userId,
                group_ids: groupIds,
                budget_name: 'Everything Else',
                category_ids: allCategoryIds,
                amount: 0,
                period: 'monthly',
                start: now.toDate(),
                is_ongoing: true,
                budget_end_date: null,
                // Backdate the window so imported (historical) transactions land in a
                // period and contribute to spend.
                coverage_start: (0, budgets_1.compute_ee_coverage_start)(now.toDate()),
            });
            await (0, job_queue_1.create_job)('process_budget_created', cascade_payload, {
                trace_id: (0, observability_1.generate_id)(),
            });
        }
        catch (cascadeError) {
            console.error(`❌ Failed to enqueue period generation for EE budget ${budgetRef.id}:`, cascadeError);
        }
        return budgetRef.id;
    }
    catch (error) {
        console.error(`❌ Error creating "everything else" budget for user ${userId}:`, error);
        throw error;
    }
}
//# sourceMappingURL=createEverythingElseBudget.js.map