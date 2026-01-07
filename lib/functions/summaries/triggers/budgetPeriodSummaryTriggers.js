"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onBudgetPeriodDeletedPeriodSummary = exports.onBudgetPeriodUpdatedPeriodSummary = exports.onBudgetPeriodCreatedPeriodSummary = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const updateUserPeriodSummary_1 = require("../orchestration/updateUserPeriodSummary");
const db = (0, firestore_2.getFirestore)();
// Debounce interval in milliseconds (5 seconds)
const SUMMARY_UPDATE_DEBOUNCE_MS = 5000;
/**
 * Check if a user_summary document was recently updated
 *
 * This prevents cascading trigger storms when multiple budget_periods
 * are created/updated rapidly (e.g., when a budget is created, it generates
 * ~78 budget_period documents, which would trigger 78 summary updates).
 *
 * @param userId - User ID
 * @param periodType - Period type (MONTHLY, BI_MONTHLY, WEEKLY)
 * @param sourcePeriodId - Source period ID
 * @returns true if summary was recently updated (within debounce window)
 */
async function wasRecentlyUpdated(userId, periodType, sourcePeriodId) {
    try {
        const summaryId = `${userId}_${periodType.toLowerCase()}_${sourcePeriodId}`;
        const summaryRef = db.collection("user_summaries").doc(summaryId);
        const summarySnap = await summaryRef.get();
        if (!summarySnap.exists) {
            // Document doesn't exist yet, so it wasn't recently updated
            return false;
        }
        const summaryData = summarySnap.data();
        const lastRecalculated = summaryData === null || summaryData === void 0 ? void 0 : summaryData.lastRecalculated;
        if (!lastRecalculated) {
            // No lastRecalculated timestamp, allow update
            return false;
        }
        const timeSinceLastUpdate = Date.now() - lastRecalculated.toMillis();
        if (timeSinceLastUpdate < SUMMARY_UPDATE_DEBOUNCE_MS) {
            console.log(`[Debounce] Summary ${summaryId} was updated ${timeSinceLastUpdate}ms ago, skipping recalculation`);
            return true;
        }
        return false;
    }
    catch (error) {
        console.error("[Debounce] Error checking recent update:", error);
        // On error, allow the update to proceed
        return false;
    }
}
/**
 * Trigger: Update user period summary when a budget period is created
 *
 * When a new budget_period is created, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Includes debounce logic to prevent rapid-fire updates during bulk operations.
 */
exports.onBudgetPeriodCreatedPeriodSummary = (0, firestore_1.onDocumentCreated)("budget_periods/{budgetPeriodId}", async (event) => {
    var _a;
    const budgetPeriod = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!budgetPeriod) {
        console.error("[onBudgetPeriodCreatedSummary] No budget period data");
        return;
    }
    console.log(`[onBudgetPeriodCreatedPeriodSummary] Budget period created: ${budgetPeriod.id}`);
    // Check if userId exists
    if (!budgetPeriod.userId) {
        console.error("[onBudgetPeriodCreatedPeriodSummary] No userId found in budget period");
        return;
    }
    try {
        // Check if summary was recently updated (debounce)
        const recentlyUpdated = await wasRecentlyUpdated(budgetPeriod.userId, String(budgetPeriod.periodType), budgetPeriod.sourcePeriodId);
        if (recentlyUpdated) {
            console.log(`[onBudgetPeriodCreatedPeriodSummary] Skipping update due to recent recalculation`);
            return;
        }
        // Update the user period summary for this period
        await (0, updateUserPeriodSummary_1.updateUserPeriodSummary)(budgetPeriod.userId, String(budgetPeriod.periodType), // Convert enum to string
        budgetPeriod.sourcePeriodId, false // Don't include detailed entries in triggers
        );
        console.log(`[onBudgetPeriodCreatedSummary] Successfully updated summary for period: ${budgetPeriod.sourcePeriodId}`);
    }
    catch (error) {
        console.error(`[onBudgetPeriodCreatedSummary] Error updating summary:`, error);
        // Don't throw - we don't want to fail the budget period creation
    }
});
/**
 * Trigger: Update user period summary when a budget period is updated
 *
 * When a budget_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Includes debounce logic to prevent rapid-fire updates during bulk operations.
 */
exports.onBudgetPeriodUpdatedPeriodSummary = (0, firestore_1.onDocumentUpdated)("budget_periods/{budgetPeriodId}", async (event) => {
    var _a;
    const budgetPeriod = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data();
    if (!budgetPeriod) {
        console.error("[onBudgetPeriodUpdatedSummary] No budget period data");
        return;
    }
    console.log(`[onBudgetPeriodUpdatedPeriodSummary] Budget period updated: ${budgetPeriod.id}`);
    // Check if userId exists
    if (!budgetPeriod.userId) {
        console.error("[onBudgetPeriodUpdatedPeriodSummary] No userId found in budget period");
        return;
    }
    try {
        // Check if summary was recently updated (debounce)
        const recentlyUpdated = await wasRecentlyUpdated(budgetPeriod.userId, String(budgetPeriod.periodType), budgetPeriod.sourcePeriodId);
        if (recentlyUpdated) {
            console.log(`[onBudgetPeriodUpdatedPeriodSummary] Skipping update due to recent recalculation`);
            return;
        }
        // Update the user period summary for this period
        await (0, updateUserPeriodSummary_1.updateUserPeriodSummary)(budgetPeriod.userId, String(budgetPeriod.periodType), // Convert enum to string
        budgetPeriod.sourcePeriodId, false // Don't include detailed entries in triggers
        );
        console.log(`[onBudgetPeriodUpdatedSummary] Successfully updated summary for period: ${budgetPeriod.sourcePeriodId}`);
    }
    catch (error) {
        console.error(`[onBudgetPeriodUpdatedSummary] Error updating summary:`, error);
        // Don't throw - we don't want to fail the budget period update
    }
});
/**
 * Trigger: Update user period summary when a budget period is deleted
 *
 * When a budget_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Includes debounce logic to prevent rapid-fire updates during bulk operations.
 */
exports.onBudgetPeriodDeletedPeriodSummary = (0, firestore_1.onDocumentDeleted)("budget_periods/{budgetPeriodId}", async (event) => {
    var _a;
    const budgetPeriod = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!budgetPeriod) {
        console.error("[onBudgetPeriodDeletedSummary] No budget period data");
        return;
    }
    console.log(`[onBudgetPeriodDeletedPeriodSummary] Budget period deleted: ${budgetPeriod.id}`);
    // Check if userId exists
    if (!budgetPeriod.userId) {
        console.error("[onBudgetPeriodDeletedPeriodSummary] No userId found in budget period");
        return;
    }
    try {
        // Check if summary was recently updated (debounce)
        const recentlyUpdated = await wasRecentlyUpdated(budgetPeriod.userId, String(budgetPeriod.periodType), budgetPeriod.sourcePeriodId);
        if (recentlyUpdated) {
            console.log(`[onBudgetPeriodDeletedPeriodSummary] Skipping update due to recent recalculation`);
            return;
        }
        // Update the user period summary for this period
        await (0, updateUserPeriodSummary_1.updateUserPeriodSummary)(budgetPeriod.userId, String(budgetPeriod.periodType), // Convert enum to string
        budgetPeriod.sourcePeriodId, false // Don't include detailed entries in triggers
        );
        console.log(`[onBudgetPeriodDeletedSummary] Successfully updated summary for period: ${budgetPeriod.sourcePeriodId}`);
    }
    catch (error) {
        console.error(`[onBudgetPeriodDeletedSummary] Error updating summary:`, error);
        // Don't throw - we don't want to fail the budget period deletion
    }
});
//# sourceMappingURL=budgetPeriodSummaryTriggers.js.map