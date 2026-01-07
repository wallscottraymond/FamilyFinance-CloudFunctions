"use strict";
/**
 * Budget Deletion Trigger - Auto-Recreation Safety Net
 *
 * Firestore trigger that fires when a budget document is deleted.
 * Automatically recreates "everything else" budgets if they are deleted
 * (either accidentally or by bypassing Cloud Functions/security rules).
 *
 * This is a safety net to ensure users always have an "everything else" budget.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onBudgetDelete = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const index_1 = require("../../../../index");
const createEverythingElseBudget_1 = require("../../utils/createEverythingElseBudget");
/**
 * Trigger: Budget document deleted
 *
 * Monitors budget deletions and automatically recreates "everything else" budgets
 * if they are deleted (safety net for direct Firestore access).
 *
 * **Process:**
 * 1. Check if deleted budget is a system "everything else" budget
 * 2. If yes, recreate it immediately for the user
 * 3. If no, do nothing (normal budget deletion)
 *
 * **Safety Net Scenarios:**
 * - User manually deletes from Firestore console
 * - Admin bypasses security rules
 * - Bug in deletion prevention logic
 * - Direct API access circumventing protections
 */
exports.onBudgetDelete = (0, firestore_1.onDocumentDeleted)({
    document: 'budgets/{budgetId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a;
    const budgetId = event.params.budgetId;
    const budgetData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    console.log(`🗑️ [onBudgetDelete] Budget deleted: ${budgetId}`);
    // 1. Check if event data exists
    if (!budgetData) {
        console.warn(`⚠️ [onBudgetDelete] No data available for deleted budget: ${budgetId}`);
        return;
    }
    // 2. Check if this was a system "everything else" budget
    if (!budgetData.isSystemEverythingElse) {
        console.log(`✅ [onBudgetDelete] Regular budget deleted (not system budget): ${budgetId}`);
        return;
    }
    // 3. System budget was deleted - this should not happen!
    console.warn(`⚠️ [onBudgetDelete] "Everything else" budget deleted for user ${budgetData.createdBy}. Recreating...`);
    try {
        // 4. Extract user information from deleted budget
        const userId = budgetData.createdBy;
        const userCurrency = budgetData.currency || 'USD';
        if (!userId) {
            console.error(`❌ [onBudgetDelete] Cannot recreate budget: missing createdBy field`);
            return;
        }
        // 5. Recreate the "everything else" budget
        const newBudgetId = await (0, createEverythingElseBudget_1.createEverythingElseBudget)(index_1.db, userId, userCurrency);
        console.log(`✅ [onBudgetDelete] Successfully recreated "everything else" budget for user ${userId}: ${newBudgetId}`);
    }
    catch (error) {
        console.error(`❌ [onBudgetDelete] Failed to recreate "everything else" budget:`, error);
        // Note: We don't throw here - this is a safety net, not a critical operation
        // The user can still use the app, but should manually create the budget
    }
});
//# sourceMappingURL=onBudgetDelete.js.map