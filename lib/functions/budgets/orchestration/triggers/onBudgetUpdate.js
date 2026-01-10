"use strict";
/**
 * Budget Update Trigger
 *
 * Automatically reassigns transactions when budget categories change.
 * Listens for updates to budget documents and triggers transaction reassignment
 * if categoryIds have been modified.
 *
 * Memory: 512MiB (higher for potential large reassignments)
 * Timeout: 60s (longer for batch operations)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onBudgetUpdatedReassignTransactions = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const reassignTransactions_1 = require("../../utils/reassignTransactions");
/**
 * Trigger: Reassign transactions when budget categories change
 *
 * Fires when a budget document is updated. Detects if categoryIds changed
 * and reassigns all affected transactions to the correct budgets.
 */
exports.onBudgetUpdatedReassignTransactions = (0, firestore_1.onDocumentUpdated)({
    document: "budgets/{budgetId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60
}, async (event) => {
    var _a, _b, _c;
    const beforeData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const afterData = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!beforeData || !afterData) {
        console.error("[onBudgetUpdate] Missing before or after data");
        return;
    }
    const budgetId = event.params.budgetId;
    console.log(`[onBudgetUpdate] Budget updated: ${budgetId} (${afterData.name})`);
    // Detect if categoryIds changed using JSON comparison
    const categoriesBefore = JSON.stringify(beforeData.categoryIds || []);
    const categoriesAfter = JSON.stringify(afterData.categoryIds || []);
    if (categoriesBefore === categoriesAfter) {
        console.log("[onBudgetUpdate] No category changes detected, skipping reassignment");
        return;
    }
    console.log("[onBudgetUpdate] Category changes detected:");
    console.log(`  Before: ${categoriesBefore}`);
    console.log(`  After: ${categoriesAfter}`);
    // Get userId from budget (handle both new access structure and legacy)
    const userId = afterData.userId || ((_c = afterData.access) === null || _c === void 0 ? void 0 : _c.createdBy);
    if (!userId) {
        console.error("[onBudgetUpdate] No userId found in budget document");
        return;
    }
    try {
        // Reassign all transactions for this budget
        console.log(`[onBudgetUpdate] Starting transaction reassignment for budget: ${budgetId}`);
        const reassignedCount = await (0, reassignTransactions_1.reassignTransactionsForBudget)(budgetId, userId);
        console.log(`[onBudgetUpdate] Successfully reassigned ${reassignedCount} transactions for budget: ${budgetId}`);
        // Note: Transaction updates will trigger their own budget spending updates
        // via onTransactionUpdate trigger, so we don't need to manually update
        // budget_periods here
    }
    catch (error) {
        console.error("[onBudgetUpdate] Error reassigning transactions:", error);
        // Don't throw - we don't want to fail the budget update
        // Transactions remain in their current state, user can manually reassign if needed
    }
});
//# sourceMappingURL=onBudgetUpdate.js.map